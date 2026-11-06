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
    address registrar = makeAddr("registrar");
    bytes32 constant TERMS = keccak256("terms-v1");

    function setUp() public {
        registry = new MockIdentityRegistry();
        roster = new AgentRoster(owner, address(registry), registrar, TERMS, "https://example.invalid/terms");
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
        assertEq(a.identityChainId, block.chainid);
    }

    // ------------------------------------------------- signed registration

    function _signed(uint256 pk, address wallet, uint256 id, uint256 idChain, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = roster.registerDigest(wallet, "https://card.invalid/a.json", id, idChain, TERMS, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_registerFor_crossChainIdentity() public {
        (address agentWallet, uint256 pk) = makeAddrAndKey("bankr-agent");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signed(pk, agentWallet, 900, 8453, deadline);
        vm.prank(registrar);
        uint256 id = roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, 8453, TERMS, deadline, sig);
        AgentRoster.Agent memory a = roster.getAgent(id);
        assertEq(a.wallet, agentWallet);
        assertEq(a.erc8004Id, 900);
        assertEq(a.identityChainId, 8453);
    }

    function test_registerFor_rules() public {
        (address agentWallet, uint256 pk) = makeAddrAndKey("agent");
        (, uint256 otherPk) = makeAddrAndKey("someone-else");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signed(pk, agentWallet, 900, 8453, deadline);
        bytes memory wrongSigner = _signed(otherPk, agentWallet, 900, 8453, deadline);
        bytes memory sameChain = _signed(pk, agentWallet, 900, block.chainid, deadline);

        vm.expectRevert(AgentRoster.NotRegistrar.selector);
        roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, 8453, TERMS, deadline, sig);

        vm.startPrank(registrar);
        vm.expectRevert(AgentRoster.BadSignature.selector);
        roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, 8453, TERMS, deadline, wrongSigner);
        vm.expectRevert(AgentRoster.BadSignature.selector); // changed field: the signature no longer matches
        roster.registerFor(agentWallet, "https://card.invalid/a.json", 901, 8453, TERMS, deadline, sig);
        // Same-chain identity is checked onchain: 900 is not registered to this wallet here.
        vm.expectRevert(AgentRoster.IdentityMismatch.selector);
        roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, block.chainid, TERMS, deadline, sameChain);

        roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, 8453, TERMS, deadline, sig);
        vm.expectRevert(AgentRoster.AlreadyRegistered.selector); // no replay
        roster.registerFor(agentWallet, "https://card.invalid/a.json", 900, 8453, TERMS, deadline, sig);
        vm.stopPrank();

        vm.warp(deadline + 1);
        (address late, uint256 latePk) = makeAddrAndKey("late");
        bytes memory lateSig = _signed(latePk, late, 5, 8453, deadline);
        vm.prank(registrar);
        vm.expectRevert(AgentRoster.SignatureExpired.selector);
        roster.registerFor(late, "https://card.invalid/a.json", 5, 8453, TERMS, deadline, lateSig);
    }

    function test_setRegistrar_onlyOwner() public {
        vm.expectRevert(AgentRoster.NotOwner.selector);
        roster.setRegistrar(builder);
        vm.prank(owner);
        roster.setRegistrar(builder);
        assertEq(roster.registrar(), builder);
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
        AgentRoster open = new AgentRoster(owner, address(0), registrar, TERMS, "t");
        vm.prank(bot);
        open.register(bot, "ipfs://x", 12345, TERMS);
    }
}
