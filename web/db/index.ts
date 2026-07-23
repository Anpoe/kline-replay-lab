import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "本地数据库绑定 `DB` 不可用。请通过项目根目录的启动 BAT 或 npm run dev 启动应用。"
    );
  }

  return drizzle(env.DB, { schema });
}
