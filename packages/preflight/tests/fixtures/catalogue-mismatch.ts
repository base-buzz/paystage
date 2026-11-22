/**
 * The catalogue-vs-challenge mismatch from #158 / #365, as a reusable fixture.
 *
 * The measurement report prints the two payees truncated (`0xF50C0D73…62BAF` and `0x8B7243F6…40b37`). These are
 * full-length synthetic stand-ins, not the live addresses: the point of the fixture is the disagreement and the 4.5×
 * price change, and inventing the missing hex would misrepresent the recorded values.
 */
export const CATALOGUE_PAYEE = "0xF50C0D73A1B2C3D4E5F60718293A4B5C6D7E62BA";
export const CHALLENGE_PAYEE = "0x8B7243F6A1B2C3D4E5F60718293A4B5C6D7E40B3";

/** Base mainnet USDC; the challenge and the catalogue agree on network and asset in this case. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_NETWORK = "eip155:8453";

/** `war-tracker.com/media/397003`: 11 000 atomic in the catalogue, 50 000 atomic live. */
export const CATALOGUE_AMOUNT = "11000";
export const CHALLENGE_AMOUNT = "50000";
