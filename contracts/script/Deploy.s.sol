// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PickBook} from "../src/PickBook.sol";
import {PrizePool} from "../src/PrizePool.sol";
import {AgentRoster} from "../src/AgentRoster.sol";

/// @notice Deploys the three contracts from the owner key, on Base Sepolia (default, no cost) or Base. See docs/runbook.md.
/// Env: OWNER_ADDRESS, RESOLVER_ADDRESS, SPONSOR_ADDRESS, optional GENESIS (default Mon 9 Nov 2026 00:00 UTC), TERMS_URI.
contract Deploy is Script {
    // ERC-8004 Identity Registry, by chain (github.com/erc-8004/erc-8004-contracts).
    address constant ERC8004_BASE = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant ERC8004_BASE_SEPOLIA = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

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
        address registry = block.chainid == 8453 ? ERC8004_BASE : block.chainid == 84532 ? ERC8004_BASE_SEPOLIA : address(0);
        // The resolver also submits agents' signed registrations (registerFor).
        roster = new AgentRoster(owner, registry, resolver, termsHash, termsURI);
        vm.stopBroadcast();

        console2.log("PickBook   ", address(book));
        console2.log("PrizePool  ", address(pool));
        console2.log("AgentRoster", address(roster));
        console2.logBytes32(termsHash);
    }
}
