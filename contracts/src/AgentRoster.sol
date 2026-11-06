// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC8004IdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @title AgentRoster
/// @notice The list of AI agents that compete in Beat the Bot. An agent registers from its own wallet, links
///         its ERC-8004 identity and accepts the league terms (which include the statement that the operator is
///         not a US person). No money moves through this contract.
/// @dev Agents whose wallets cannot send transactions on this chain sign an EIP-712 registration instead, and
///      the registrar submits it with `registerFor`. If the identity lives on another chain, the registrar
///      checks it there before submitting; `identityChainId` records where it lives.
contract AgentRoster {
    struct Agent {
        address wallet;
        uint256 erc8004Id;
        uint64 registeredAt;
        bool active;
        uint256 identityChainId;
        string metadataURI;
    }

    uint256 public constant MAX_URI_LENGTH = 512;
    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Register(address wallet,string metadataURI,uint256 erc8004Id,uint256 identityChainId,bytes32 termsHash,uint256 deadline)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _ERC6492_MAGIC = 0x6492649264926492649264926492649264926492649264926492649264926492;

    /// @notice ERC-8004 Identity Registry used to check that an identity belongs to the wallet (zero disables).
    address public immutable identityRegistry;

    address public owner;
    address public pendingOwner;
    /// @notice May submit agents' signed registrations (`registerFor`).
    address public registrar;
    bytes32 public termsHash;
    string public termsURI;
    uint256 public agentCount;

    mapping(uint256 agentId => Agent) private _agents;
    mapping(address wallet => uint256 agentId) public agentIdOf;

    event Registered(
        uint256 indexed agentId,
        address indexed wallet,
        uint256 indexed erc8004Id,
        uint256 identityChainId,
        string metadataURI,
        bytes32 terms
    );
    event RegistrarSet(address indexed registrar);
    event URIUpdated(uint256 indexed agentId, string metadataURI);
    event ActiveSet(uint256 indexed agentId, bool active);
    event TermsSet(bytes32 termsHash, string termsURI);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotWallet();
    error ZeroAddress();
    error TermsNotAccepted();
    error AlreadyRegistered();
    error BadURI();
    error IdentityMismatch();
    error UnknownAgent();
    error NotRegistrar();
    error SignatureExpired();
    error BadSignature();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address identityRegistry_, address registrar_, bytes32 termsHash_, string memory termsURI_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        identityRegistry = identityRegistry_;
        registrar = registrar_;
        termsHash = termsHash_;
        termsURI = termsURI_;
        emit OwnershipTransferred(address(0), owner_);
        emit RegistrarSet(registrar_);
        emit TermsSet(termsHash_, termsURI_);
    }

    /// @notice Registers the calling wallet as an agent. Its ERC-8004 identity must be on this chain.
    /// @param wallet must be the caller: an agent registers from the wallet it trades with.
    /// @param acceptedTermsHash must equal `termsHash`, which records acceptance of the current terms onchain.
    function register(address wallet, string calldata metadataURI, uint256 erc8004Id, bytes32 acceptedTermsHash)
        external
        returns (uint256 agentId)
    {
        if (msg.sender != wallet) revert NotWallet();
        if (identityRegistry != address(0) && !_identityBelongsTo(erc8004Id, wallet)) revert IdentityMismatch();
        return _register(wallet, metadataURI, erc8004Id, block.chainid, acceptedTermsHash);
    }

    /// @notice Submits a registration the agent's wallet signed (EIP-712). Only the registrar may submit.
    ///         If the identity is on this chain it is checked here; otherwise the registrar checked it on its chain.
    function registerFor(
        address wallet,
        string calldata metadataURI,
        uint256 erc8004Id,
        uint256 identityChainId,
        bytes32 acceptedTermsHash,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 agentId) {
        if (msg.sender != registrar) revert NotRegistrar();
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = registerDigest(wallet, metadataURI, erc8004Id, identityChainId, acceptedTermsHash, deadline);
        if (!_isValidSignature(wallet, digest, signature)) revert BadSignature();
        if (identityChainId == block.chainid && identityRegistry != address(0) && !_identityBelongsTo(erc8004Id, wallet)) {
            revert IdentityMismatch();
        }
        return _register(wallet, metadataURI, erc8004Id, identityChainId, acceptedTermsHash);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(_DOMAIN_TYPEHASH, keccak256("Beat the Bot AgentRoster"), keccak256("1"), block.chainid, address(this))
        );
    }

    function registerDigest(
        address wallet,
        string calldata metadataURI,
        uint256 erc8004Id,
        uint256 identityChainId,
        bytes32 acceptedTermsHash,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_TYPEHASH, wallet, keccak256(bytes(metadataURI)), erc8004Id, identityChainId, acceptedTermsHash, deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function updateURI(uint256 agentId, string calldata metadataURI) external {
        Agent storage a = _agents[agentId];
        if (a.wallet == address(0)) revert UnknownAgent();
        if (msg.sender != a.wallet) revert NotWallet();
        _checkURI(metadataURI);
        a.metadataURI = metadataURI;
        emit URIUpdated(agentId, metadataURI);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (_agents[agentId].wallet == address(0)) revert UnknownAgent();
        return _agents[agentId];
    }

    // ------------------------------------------------------------------ owner

    /// @notice Removes or restores an agent on the league table (moderation). Its record stays onchain.
    function setActive(uint256 agentId, bool active) external onlyOwner {
        if (_agents[agentId].wallet == address(0)) revert UnknownAgent();
        _agents[agentId].active = active;
        emit ActiveSet(agentId, active);
    }

    function setRegistrar(address registrar_) external onlyOwner {
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function setTerms(bytes32 termsHash_, string calldata termsURI_) external onlyOwner {
        termsHash = termsHash_;
        termsURI = termsURI_;
        emit TermsSet(termsHash_, termsURI_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // --------------------------------------------------------------- internal

    function _register(address wallet, string calldata metadataURI, uint256 erc8004Id, uint256 identityChainId, bytes32 acceptedTermsHash)
        internal
        returns (uint256 agentId)
    {
        if (termsHash == bytes32(0) || acceptedTermsHash != termsHash) revert TermsNotAccepted();
        if (agentIdOf[wallet] != 0) revert AlreadyRegistered();
        _checkURI(metadataURI);
        agentId = ++agentCount;
        _agents[agentId] = Agent({
            wallet: wallet,
            erc8004Id: erc8004Id,
            registeredAt: uint64(block.timestamp),
            active: true,
            identityChainId: identityChainId,
            metadataURI: metadataURI
        });
        agentIdOf[wallet] = agentId;
        emit Registered(agentId, wallet, erc8004Id, identityChainId, metadataURI, acceptedTermsHash);
    }

    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) internal returns (bool) {
        if (signature.length >= 32 && bytes32(signature[signature.length - 32:]) == _ERC6492_MAGIC) {
            (address factory, bytes memory factoryCalldata, bytes memory inner) =
                abi.decode(signature[:signature.length - 32], (address, bytes, bytes));
            if (signer.code.length == 0) {
                (bool deployed,) = factory.call(factoryCalldata);
                if (!deployed || signer.code.length == 0) return false;
            }
            return _isValid1271(signer, digest, inner);
        }
        if (signer.code.length > 0) return _isValid1271(signer, digest, signature);
        if (signature.length != 65) return false;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;
        if (v != 27 && v != 28) return false;
        address rec = ecrecover(digest, v, r, s);
        return rec != address(0) && rec == signer;
    }

    function _isValid1271(address signer, bytes32 digest, bytes memory signature) internal view returns (bool) {
        (bool ok, bytes memory ret) = signer.staticcall(abi.encodeWithSelector(0x1626ba7e, digest, signature));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == bytes4(0x1626ba7e);
    }

    function _checkURI(string calldata uri) internal pure {
        uint256 len = bytes(uri).length;
        if (len == 0 || len > MAX_URI_LENGTH) revert BadURI();
    }

    function _identityBelongsTo(uint256 erc8004Id, address wallet) internal view returns (bool) {
        IERC8004IdentityRegistry reg = IERC8004IdentityRegistry(identityRegistry);
        try reg.ownerOf(erc8004Id) returns (address o) {
            if (o == wallet) return true;
        } catch {}
        try reg.getAgentWallet(erc8004Id) returns (address w) {
            if (w == wallet) return true;
        } catch {}
        return false;
    }
}
