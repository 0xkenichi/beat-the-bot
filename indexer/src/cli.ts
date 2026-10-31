import { makePublicClient } from "@btb/shared";
import { getDb, migrate } from "@btb/shared/db";
import { loadEnv } from "@btb/shared/env";
import { runOnce } from "./index";

loadEnv();
const db = await getDb();
await migrate(db);
await runOnce(makePublicClient(), db);
process.exit(0);
