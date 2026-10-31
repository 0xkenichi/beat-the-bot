// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal ERC-20 with switches for the failure modes PrizePool must survive.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked; // transfers to these addresses fail
    bool public returnFalseInsteadOfRevert;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function setReturnFalse(bool b) external {
        returnFalseInsteadOfRevert = b;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (blocked[to]) {
            if (returnFalseInsteadOfRevert) return false;
            revert("blocked");
        }
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Models the parts of a B20 tokenized stock that matter here: raw balances, a WAD multiplier
///      (`uiMultiplier`, `balanceOfUI`) and a blocklist transfer policy that reverts with PolicyForbids.
contract MockB20 {
    error PolicyForbids(bytes32 scope, uint64 policyId);

    bytes32 public constant TRANSFER_RECEIVER_POLICY = keccak256("TRANSFER_RECEIVER_POLICY");
    uint256 public constant WAD_PRECISION = 1e18;
    uint8 public constant decimals = 8;
    uint256 public uiMultiplier = 1e18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public policyBlocked;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function setMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setPolicyBlocked(address a, bool b) external {
        policyBlocked[a] = b;
    }

    function multiplier() external view returns (uint256) {
        return uiMultiplier;
    }

    function balanceOfUI(address a) external view returns (uint256) {
        return balanceOf[a] * uiMultiplier / WAD_PRECISION;
    }

    function toUIAmount(uint256 raw) external view returns (uint256) {
        return raw * uiMultiplier / WAD_PRECISION;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; // approve is not policy gated
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (policyBlocked[to]) revert PolicyForbids(TRANSFER_RECEIVER_POLICY, 5);
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev ERC-1271 smart account controlled by one EOA key (like a smart wallet with one owner).
contract MockSmartAccount {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length != 65) return 0xffffffff;
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        return ecrecover(hash, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// @dev CREATE2 factory for MockSmartAccount, used for ERC-6492 (counterfactual account) signatures.
contract MockAccountFactory {
    function createAccount(address signer, bytes32 salt) external returns (address account) {
        account = address(new MockSmartAccount{salt: salt}(signer));
    }

    function predict(address signer, bytes32 salt) external view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(abi.encodePacked(type(MockSmartAccount).creationCode, abi.encode(signer)))
            )
        );
        return address(uint160(uint256(h)));
    }
}

/// @dev Stand-in for the ERC-8004 Identity Registry (ERC-721 owner plus an agent wallet).
contract MockIdentityRegistry {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getAgentWallet;

    function set(uint256 id, address owner_, address wallet_) external {
        ownerOf[id] = owner_;
        getAgentWallet[id] = wallet_;
    }
}
