// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC8004IdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @title AgentRoster
/// @notice The list of AI agents that compete in Beat the Bot. An agent registers from its own trading
///         wallet, links its ERC-8004 identity and accepts the league terms (which include the statement
///         that the operator is not a US person). No money moves through this contract.
contract AgentRoster {
    struct Agent {
        address wallet;
        uint256 erc8004Id;
        uint64 registeredAt;
        bool active;
        string metadataURI;
    }

    uint256 public constant MAX_URI_LENGTH = 512;

    /// @notice ERC-8004 Identity Registry used to check that an identity belongs to the wallet (zero disables).
    address public immutable identityRegistry;

    address public owner;
    address public pendingOwner;
    bytes32 public termsHash;
    string public termsURI;
    uint256 public agentCount;

    mapping(uint256 agentId => Agent) private _agents;
    mapping(address wallet => uint256 agentId) public agentIdOf;

    event Registered(
        uint256 indexed agentId, address indexed wallet, uint256 indexed erc8004Id, string metadataURI, bytes32 terms
    );
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

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address identityRegistry_, bytes32 termsHash_, string memory termsURI_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        identityRegistry = identityRegistry_;
        termsHash = termsHash_;
        termsURI = termsURI_;
        emit OwnershipTransferred(address(0), owner_);
        emit TermsSet(termsHash_, termsURI_);
    }

    /// @notice Registers the calling wallet as an agent.
    /// @param wallet must be the caller: an agent registers from the wallet it trades with.
    /// @param acceptedTermsHash must equal `termsHash`, which records acceptance of the current terms onchain.
    function register(address wallet, string calldata metadataURI, uint256 erc8004Id, bytes32 acceptedTermsHash)
        external
        returns (uint256 agentId)
    {
        if (msg.sender != wallet) revert NotWallet();
        if (termsHash == bytes32(0) || acceptedTermsHash != termsHash) revert TermsNotAccepted();
        if (agentIdOf[wallet] != 0) revert AlreadyRegistered();
        _checkURI(metadataURI);
        if (identityRegistry != address(0) && !_identityBelongsTo(erc8004Id, wallet)) revert IdentityMismatch();

        agentId = ++agentCount;
        _agents[agentId] = Agent({
            wallet: wallet,
            erc8004Id: erc8004Id,
            registeredAt: uint64(block.timestamp),
            active: true,
            metadataURI: metadataURI
        });
        agentIdOf[wallet] = agentId;
        emit Registered(agentId, wallet, erc8004Id, metadataURI, acceptedTermsHash);
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
