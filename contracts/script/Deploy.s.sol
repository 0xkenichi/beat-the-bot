// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PickBook} from "../src/PickBook.sol";
import {PrizePool} from "../src/PrizePool.sol";
import {AgentRoster} from "../src/AgentRoster.sol";

/// @notice Deploys the three contracts from the owner key. Run by Kenichi:
///   forge script script/Deploy.s.sol --rpc-url base --account btb-owner --sender $OWNER_ADDRESS --broadcast --verify
/// Env: OWNER_ADDRESS, RESOLVER_ADDRESS, SPONSOR_ADDRESS, optional GENESIS (default Mon 9 Nov 2026 00:00 UTC), TERMS_URI.
contract Deploy is Script {
    address constant ERC8004_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external returns (PickBook book, PrizePool pool, AgentRoster roster) {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address resolver = vm.envAddress("RESOLVER_ADDRESS");
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");
        uint64 genesis = uint64(vm.envOr("GENESIS", uint256(1_794_182_400)));
        string memory termsURI = vm.envOr("TERMS_URI", string("https://github.com/0xkenichi/beat-the-bot/blob/main/docs/legal/agent-terms.md"));
        bytes32 termsHash = keccak256(bytes(vm.readFile("../docs/legal/agent-terms.md")));
        require(owner != resolver && owner != sponsor && resolver != sponsor, "use three different keys");

        vm.startBroadcast();
        book = new PickBook(owner);
        pool = new PrizePool(owner, resolver, sponsor, genesis);
        roster = new AgentRoster(owner, ERC8004_IDENTITY, termsHash, termsURI);
        vm.stopBroadcast();

        console2.log("PickBook   ", address(book));
        console2.log("PrizePool  ", address(pool));
        console2.log("AgentRoster", address(roster));
        console2.logBytes32(termsHash);
    }
}
