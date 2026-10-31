// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRoster} from "../src/AgentRoster.sol";
import {MockIdentityRegistry} from "./mocks/Mocks.sol";

contract AgentRosterTest is Test {
    AgentRoster roster;
    MockIdentityRegistry registry;
    address owner = makeAddr("owner");
    address bot = makeAddr("bot-wallet");
    address builder = makeAddr("builder");
    bytes32 constant TERMS = keccak256("terms-v1");

    function setUp() public {
        registry = new MockIdentityRegistry();
        roster = new AgentRoster(owner, address(registry), TERMS, "https://example.invalid/terms");
        registry.set(42, bot, bot);
        registry.set(43, builder, bot); // identity owned by a builder, agent wallet = bot
    }

    function test_register() public {
        vm.prank(bot);
        uint256 id = roster.register(bot, "ipfs://agent-card", 42, TERMS);
        assertEq(id, 1);
        assertEq(roster.agentIdOf(bot), 1);
        AgentRoster.Agent memory a = roster.getAgent(1);
        assertEq(a.wallet, bot);
        assertEq(a.erc8004Id, 42);
        assertTrue(a.active);
        assertEq(a.metadataURI, "ipfs://agent-card");
    }

    function test_register_acceptsAgentWalletLink() public {
        vm.prank(bot);
        roster.register(bot, "ipfs://x", 43, TERMS);
    }

    function test_register_rules() public {
        vm.prank(builder);
        vm.expectRevert(AgentRoster.NotWallet.selector);
        roster.register(bot, "ipfs://x", 42, TERMS);

        vm.startPrank(bot);
        vm.expectRevert(AgentRoster.TermsNotAccepted.selector);
        roster.register(bot, "ipfs://x", 42, keccak256("old-terms"));
        vm.expectRevert(AgentRoster.BadURI.selector);
        roster.register(bot, "", 42, TERMS);
        vm.expectRevert(AgentRoster.IdentityMismatch.selector);
        roster.register(bot, "ipfs://x", 99, TERMS);
        roster.register(bot, "ipfs://x", 42, TERMS);
        vm.expectRevert(AgentRoster.AlreadyRegistered.selector);
        roster.register(bot, "ipfs://y", 42, TERMS);
        vm.stopPrank();
    }

    function test_updateURI_and_moderation() public {
        vm.prank(bot);
        roster.register(bot, "ipfs://x", 42, TERMS);
        vm.prank(builder);
        vm.expectRevert(AgentRoster.NotWallet.selector);
        roster.updateURI(1, "ipfs://evil");
        vm.prank(bot);
        roster.updateURI(1, "ipfs://v2");
        assertEq(roster.getAgent(1).metadataURI, "ipfs://v2");

        vm.expectRevert(AgentRoster.NotOwner.selector);
        roster.setActive(1, false);
        vm.prank(owner);
        roster.setActive(1, false);
        assertFalse(roster.getAgent(1).active);
        vm.expectRevert(AgentRoster.UnknownAgent.selector);
        roster.getAgent(2);
    }

    function test_newTermsRequireNewAcceptance() public {
        vm.prank(owner);
        roster.setTerms(keccak256("terms-v2"), "https://example.invalid/terms-v2");
        vm.prank(bot);
        vm.expectRevert(AgentRoster.TermsNotAccepted.selector);
        roster.register(bot, "ipfs://x", 42, TERMS);
    }

    function test_noRegistryMeansNoIdentityCheck() public {
        AgentRoster open = new AgentRoster(owner, address(0), TERMS, "t");
        vm.prank(bot);
        open.register(bot, "ipfs://x", 12345, TERMS);
    }
}
