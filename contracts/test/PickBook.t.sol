// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PickBook} from "../src/PickBook.sol";
import {MockSmartAccount, MockAccountFactory} from "./mocks/Mocks.sol";

contract PickBookTest is Test {
    PickBook book;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address[] tokens;
    uint32 constant WEEK = 1;
    uint64 openAt;
    uint64 closeAt;

    event Locked(
        uint32 indexed weekId,
        address indexed player,
        uint8[3] tokenIndexes,
        uint16[3] weightsBps,
        bytes32 picksHash,
        bool overwrite
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        book = new PickBook(owner);
        for (uint256 i; i < 10; ++i) {
            tokens.push(address(uint160(0xB200 + i)));
        }
        openAt = uint64(block.timestamp + 1 hours);
        closeAt = uint64(block.timestamp + 1 days);
        vm.prank(owner);
        book.setWeek(WEEK, openAt, closeAt, tokens);
    }

    function _picks(uint8 a, uint16 wa, uint8 b, uint16 wb, uint8 c, uint16 wc)
        internal
        pure
        returns (PickBook.Pick[3] memory p)
    {
        p[0] = PickBook.Pick(a, wa);
        p[1] = PickBook.Pick(b, wb);
        p[2] = PickBook.Pick(c, wc);
    }

    // ------------------------------------------------------------- setWeek

    function test_setWeek_onlyOwner() public {
        vm.expectRevert(PickBook.NotOwner.selector);
        book.setWeek(2, openAt, closeAt, tokens);
    }

    function test_setWeek_storesAndEmits() public view {
        (uint64 o, uint64 c, address[] memory t) = book.getWeek(WEEK);
        assertEq(o, openAt);
        assertEq(c, closeAt);
        assertEq(t.length, 10);
        assertEq(t[3], tokens[3]);
    }

    function test_setWeek_rejectsBadInput() public {
        vm.startPrank(owner);
        vm.expectRevert(PickBook.BadWeek.selector);
        book.setWeek(0, openAt, closeAt, tokens);
        vm.expectRevert(PickBook.BadWindow.selector);
        book.setWeek(2, closeAt, openAt, tokens);
        vm.expectRevert(PickBook.BadWindow.selector);
        book.setWeek(2, uint64(block.timestamp - 10), uint64(block.timestamp), tokens);

        address[] memory two = new address[](2);
        two[0] = tokens[0];
        two[1] = tokens[1];
        vm.expectRevert(PickBook.BadTokenCount.selector);
        book.setWeek(2, openAt, closeAt, two);

        address[] memory dup = new address[](3);
        dup[0] = tokens[0];
        dup[1] = tokens[1];
        dup[2] = tokens[0];
        vm.expectRevert(PickBook.DuplicateToken.selector);
        book.setWeek(2, openAt, closeAt, dup);

        address[] memory zero = new address[](3);
        zero[0] = tokens[0];
        zero[1] = address(0);
        zero[2] = tokens[2];
        vm.expectRevert(PickBook.ZeroAddress.selector);
        book.setWeek(2, openAt, closeAt, zero);
        vm.stopPrank();
    }

    function test_setWeek_canChangeBeforeOpen_notAfter() public {
        address[] memory three = new address[](3);
        three[0] = tokens[5];
        three[1] = tokens[6];
        three[2] = tokens[7];
        vm.prank(owner);
        book.setWeek(WEEK, openAt, closeAt, three); // still before openAt
        (,, address[] memory t) = book.getWeek(WEEK);
        assertEq(t.length, 3);

        vm.warp(openAt);
        vm.prank(owner);
        vm.expectRevert(PickBook.WeekStarted.selector);
        book.setWeek(WEEK, openAt, closeAt, tokens);
    }

    // ---------------------------------------------------------------- lock

    function test_lock_happyPath() public {
        vm.warp(openAt);
        PickBook.Pick[3] memory p = _picks(0, 5000, 3, 3000, 7, 2000);
        bytes32 h = keccak256(abi.encode(p));
        vm.expectEmit(true, true, false, true);
        emit Locked(WEEK, alice, [uint8(0), 3, 7], [uint16(5000), 3000, 2000], h, false);
        vm.prank(alice);
        book.lock(WEEK, p);
        assertEq(book.pickHash(WEEK, alice), h);
        assertEq(book.lockedAt(WEEK, alice), openAt);
        assertEq(book.entrants(WEEK), 1);
        assertEq(book.nonces(alice), 1);
        assertEq(book.hashPicks(p), h);
    }

    function test_lock_window() public {
        PickBook.Pick[3] memory p = _picks(0, 5000, 1, 3000, 2, 2000);
        vm.prank(alice);
        vm.expectRevert(PickBook.EntryNotOpen.selector);
        book.lock(WEEK, p);

        vm.warp(closeAt - 1);
        vm.prank(alice);
        book.lock(WEEK, p);

        vm.warp(closeAt);
        vm.prank(bob);
        vm.expectRevert(PickBook.EntryClosed.selector);
        book.lock(WEEK, p);

        vm.prank(bob);
        vm.expectRevert(PickBook.WeekNotSet.selector);
        book.lock(9, p);
    }

    function test_lock_rejectsBadPicks() public {
        vm.warp(openAt);
        vm.startPrank(alice);
        vm.expectRevert(PickBook.DuplicateToken.selector);
        book.lock(WEEK, _picks(1, 5000, 1, 3000, 2, 2000));
        vm.expectRevert(PickBook.DuplicateToken.selector);
        book.lock(WEEK, _picks(1, 5000, 2, 3000, 1, 2000));
        vm.expectRevert(PickBook.BadToken.selector);
        book.lock(WEEK, _picks(0, 5000, 1, 3000, 10, 2000));
        vm.expectRevert(PickBook.BadWeights.selector);
        book.lock(WEEK, _picks(0, 5000, 1, 3000, 2, 1999));
        vm.expectRevert(PickBook.BadWeights.selector);
        book.lock(WEEK, _picks(0, 10000, 1, 0, 2, 0));
        vm.stopPrank();
    }

    function test_lock_overwriteBeforeClose() public {
        vm.warp(openAt);
        vm.prank(alice);
        book.lock(WEEK, _picks(0, 5000, 1, 3000, 2, 2000));
        vm.warp(openAt + 100);
        PickBook.Pick[3] memory p2 = _picks(4, 3400, 5, 3300, 6, 3300);
        vm.expectEmit(true, true, false, true);
        emit Locked(WEEK, alice, [uint8(4), 5, 6], [uint16(3400), 3300, 3300], keccak256(abi.encode(p2)), true);
        vm.prank(alice);
        book.lock(WEEK, p2);
        assertEq(book.pickHash(WEEK, alice), keccak256(abi.encode(p2)));
        assertEq(book.lockedAt(WEEK, alice), openAt + 100);
        assertEq(book.entrants(WEEK), 1, "overwrite does not add an entrant");
    }

    function test_pause() public {
        vm.warp(openAt);
        vm.prank(owner);
        book.setPaused(true);
        assertFalse(book.isOpen(WEEK));
        vm.prank(alice);
        vm.expectRevert(PickBook.IsPaused.selector);
        book.lock(WEEK, _picks(0, 5000, 1, 3000, 2, 2000));
        vm.prank(owner);
        book.setPaused(false);
        assertTrue(book.isOpen(WEEK));
        vm.prank(alice);
        book.lock(WEEK, _picks(0, 5000, 1, 3000, 2, 2000));
    }

    function test_ownership_twoStep() public {
        vm.prank(owner);
        book.transferOwnership(alice);
        assertEq(book.owner(), owner);
        vm.prank(bob);
        vm.expectRevert(PickBook.NotPendingOwner.selector);
        book.acceptOwnership();
        vm.prank(alice);
        book.acceptOwnership();
        assertEq(book.owner(), alice);
    }

    function testFuzz_lock_weights(uint16 a, uint16 b) public {
        vm.warp(openAt);
        a = uint16(bound(a, 0, 10_000));
        b = uint16(bound(b, 0, 10_000));
        uint256 ab = uint256(a) + uint256(b);
        bool valid = ab < 10_000 && a > 0 && b > 0;
        uint16 c = ab < 10_000 ? uint16(10_000 - ab) : 1;
        PickBook.Pick[3] memory p = _picks(0, a, 1, b, 2, c);
        vm.prank(alice);
        if (!valid) vm.expectRevert(PickBook.BadWeights.selector);
        book.lock(WEEK, p);
    }

    // ---------------------------------------------- signed locks (fallback)

    function test_lockFor_eoaSignature_andReplayProtection() public {
        vm.warp(openAt);
        (address player, uint256 pk) = makeAddrAndKey("player");
        PickBook.Pick[3] memory p = _picks(0, 5000, 1, 3000, 2, 2000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = book.lockDigest(player, WEEK, keccak256(abi.encode(p)), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(bob); // anyone can relay
        book.lockFor(player, WEEK, p, deadline, sig);
        assertEq(book.pickHash(WEEK, player), keccak256(abi.encode(p)));

        // The same signature cannot be replayed (the nonce moved on).
        vm.expectRevert(PickBook.BadSignature.selector);
        book.lockFor(player, WEEK, p, deadline, sig);
    }

    function test_lockFor_rejectsWrongSignerAndExpired() public {
        vm.warp(openAt);
        (address player,) = makeAddrAndKey("player");
        (, uint256 otherPk) = makeAddrAndKey("other");
        PickBook.Pick[3] memory p = _picks(0, 5000, 1, 3000, 2, 2000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = book.lockDigest(player, WEEK, keccak256(abi.encode(p)), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherPk, digest);
        vm.expectRevert(PickBook.BadSignature.selector);
        book.lockFor(player, WEEK, p, deadline, abi.encodePacked(r, s, v));

        vm.warp(deadline + 1);
        vm.expectRevert(PickBook.SignatureExpired.selector);
        book.lockFor(player, WEEK, p, deadline, abi.encodePacked(r, s, v));
    }

    function test_lockFor_erc1271SmartAccount() public {
        vm.warp(openAt);
        (address signer, uint256 pk) = makeAddrAndKey("owner-key");
        MockSmartAccount account = new MockSmartAccount(signer);
        PickBook.Pick[3] memory p = _picks(2, 4000, 4, 4000, 9, 2000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = book.lockDigest(address(account), WEEK, keccak256(abi.encode(p)), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        book.lockFor(address(account), WEEK, p, deadline, abi.encodePacked(r, s, v));
        assertEq(book.pickHash(WEEK, address(account)), keccak256(abi.encode(p)));
    }

    function test_lockFor_erc6492UndeployedAccount() public {
        vm.warp(openAt);
        (address signer, uint256 pk) = makeAddrAndKey("owner-key");
        MockAccountFactory factory = new MockAccountFactory();
        bytes32 salt = bytes32(uint256(7));
        address account = factory.predict(signer, salt);
        assertEq(account.code.length, 0);

        PickBook.Pick[3] memory p = _picks(2, 4000, 4, 4000, 9, 2000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = book.lockDigest(account, WEEK, keccak256(abi.encode(p)), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory wrapped = abi.encodePacked(
            abi.encode(
                address(factory),
                abi.encodeCall(MockAccountFactory.createAccount, (signer, salt)),
                abi.encodePacked(r, s, v)
            ),
            bytes32(0x6492649264926492649264926492649264926492649264926492649264926492)
        );
        book.lockFor(account, WEEK, p, deadline, wrapped);
        assertGt(account.code.length, 0, "account deployed by the 6492 path");
        assertEq(book.pickHash(WEEK, account), keccak256(abi.encode(p)));
    }
}
