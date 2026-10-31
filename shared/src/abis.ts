import { parseAbi } from "viem";
export * from "./generated/contracts";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** B20 tokenized-stock extensions (docs.base.org/specifications/b20/reference/interfaces/ib20-asset). */
export const b20Abi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function balanceOfUI(address account) view returns (uint256)",
  "function toUIAmount(uint256 raw) view returns (uint256)",
  "function fromUIAmount(uint256 ui) view returns (uint256)",
  "function policyId(bytes32 scope) view returns (uint64)",
  "function pausedFeatures() view returns (uint8)",
]);

export const policyRegistryAbi = parseAbi([
  "function policyExists(uint64 policyId) view returns (bool)",
  "function isAuthorized(uint64 policyId, address account) view returns (bool)",
]);

export const aggregatorAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const clPoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
  "function factory() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);

export const clFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)",
]);

/** Aerodrome Slipstream SwapRouter. */
export const clRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; int24 tickSpacing; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
  "function factory() view returns (address)",
]);

/** ERC-8004 Identity Registry (eips.ethereum.org/EIPS/eip-8004). */
export const erc8004IdentityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
