import { DukascopyOfficialClient, formatDukascopyCsv } from "../../lib/fx/dukascopyOfficialClient";

function dateValue(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instrument = url.searchParams.get("instrument")?.trim().toUpperCase() ?? "";
  const start = dateValue(url.searchParams.get("start"), "");
  const end = dateValue(url.searchParams.get("end"), "");
  const timeframe = url.searchParams.get("timeframe")?.trim().toLowerCase() || "1m";
  if (!/^[A-Z0-9/_-]{3,24}$/.test(instrument) || !start || !end) {
    return Response.json({ error: "instrument、start 和 end 是必填参数" }, { status: 400 });
  }
  if (!["1m", "m1", "minute", "1"].includes(timeframe)) {
    return Response.json({ error: "内置 Dukascopy 适配器只提供 1 分钟原始数据" }, { status: 400 });
  }

  try {
    const result = await new DukascopyOfficialClient().downloadAndParseCsv({
      instrument,
      start,
      end,
      timeframe,
    });
    return new Response(formatDukascopyCsv(result.candles), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
        "x-dukascopy-available-from": result.availableFrom == null ? "" : new Date(result.availableFrom).toISOString(),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Dukascopy 官方数据读取失败" }, { status: 502 });
  }
}
