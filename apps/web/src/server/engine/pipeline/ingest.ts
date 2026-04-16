import "server-only";
import { ingestBinance } from "@/server/jobs/ingestBinance";
import { ingestKraken } from "@/server/jobs/ingestKraken";

export type IngestStepResult = {
  inserted: number;
  skipped: number;
  errors: string[];
};

export async function runIngestStep(): Promise<IngestStepResult> {
  const [binance, kraken] = await Promise.all([ingestBinance(), ingestKraken()]);

  return {
    inserted: binance.inserted + kraken.inserted,
    skipped: binance.skipped + kraken.skipped,
    errors: [
      ...binance.errors.map((e) => `binance:${e.symbol}:${e.error}`),
      ...kraken.errors.map((e) => `kraken:${e.symbol}:${e.error}`)
    ]
  };
}
