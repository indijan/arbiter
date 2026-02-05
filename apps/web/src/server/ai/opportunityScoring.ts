type FeatureVector = {
  names: string[];
  values: number[];
};

export type FeatureBundle = {
  vector: FeatureVector;
  meta: Record<string, unknown>;
};

type TrainingRow = {
  vector: FeatureVector;
  label: number;
};

const MIN_SAMPLES = 20;
const RIDGE_LAMBDA = 1e-3;

export function variantForOpportunity(opportunityId: number): "A" | "B" {
  const hash = (opportunityId * 2654435761) >>> 0;
  return hash % 2 === 0 ? "A" : "B";
}

export function buildFeatureBundle(input: {
  type: string;
  net_edge_bps: number | null;
  confidence: number | null;
  details: Record<string, unknown> | null;
}) {
  const details = input.details ?? {};
  const netEdge = Number(input.net_edge_bps ?? 0);
  const confidence = Number(input.confidence ?? 0.5);
  const breakEven = Number((details as Record<string, unknown>).break_even_hours ?? 0);
  const fundingDaily = Number((details as Record<string, unknown>).funding_daily_bps ?? 0);
  const basisBps = Number((details as Record<string, unknown>).basis_bps ?? 0);

  const isCarry = input.type === "spot_perp_carry" ? 1 : 0;
  const isXarb = input.type === "xarb_spot" ? 1 : 0;
  const isTri = input.type === "tri_arb" ? 1 : 0;

  const names = [
    "bias",
    "net_edge_bps",
    "confidence",
    "break_even_hours",
    "funding_daily_bps",
    "basis_bps",
    "is_carry",
    "is_xarb",
    "is_tri"
  ];

  const values = [
    1,
    netEdge,
    confidence,
    Number.isFinite(breakEven) ? breakEven : 0,
    Number.isFinite(fundingDaily) ? fundingDaily : 0,
    Number.isFinite(basisBps) ? basisBps : 0,
    isCarry,
    isXarb,
    isTri
  ];

  return {
    vector: { names, values },
    meta: {
      net_edge_bps: netEdge,
      confidence,
      break_even_hours: breakEven,
      funding_daily_bps: fundingDaily,
      basis_bps: basisBps,
      type: input.type
    }
  } satisfies FeatureBundle;
}

function transpose(matrix: number[][]) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

function multiply(a: number[][], b: number[][]) {
  const result = Array.from({ length: a.length }, () =>
    Array.from({ length: b[0].length }, () => 0)
  );
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      for (let j = 0; j < b[0].length; j += 1) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

function addIdentity(matrix: number[][], lambda: number) {
  return matrix.map((row, i) =>
    row.map((value, j) => (i === j ? value + lambda : value))
  );
}

function invert(matrix: number[][]) {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  ]);

  for (let i = 0; i < n; i += 1) {
    let pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-12) {
      for (let r = i + 1; r < n; r += 1) {
        if (Math.abs(augmented[r][i]) > Math.abs(pivot)) {
          const tmp = augmented[i];
          augmented[i] = augmented[r];
          augmented[r] = tmp;
          pivot = augmented[i][i];
          break;
        }
      }
    }

    if (Math.abs(pivot) < 1e-12) {
      throw new Error("Singular matrix");
    }

    for (let j = 0; j < 2 * n; j += 1) {
      augmented[i][j] /= pivot;
    }

    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = augmented[r][i];
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[r][j] -= factor * augmented[i][j];
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

function multiplyVector(matrix: number[][], vector: number[]) {
  return matrix.map((row) => row.reduce((sum, value, idx) => sum + value * vector[idx], 0));
}

export function trainWeights(rows: TrainingRow[]) {
  if (rows.length < MIN_SAMPLES) {
    return null;
  }

  const x = rows.map((row) => row.vector.values);
  const y = rows.map((row) => [row.label]);

  const xt = transpose(x);
  const xtx = multiply(xt, x);
  const xtxRidge = addIdentity(xtx, RIDGE_LAMBDA);
  const xtxInv = invert(xtxRidge);
  const xty = multiply(xt, y);
  const weights = multiply(xtxInv, xty);

  return weights.map((row) => row[0]);
}

export function predictScore(weights: number[] | null, vector: FeatureVector) {
  if (!weights) {
    return null;
  }
  return weights.reduce((sum, weight, idx) => sum + weight * vector.values[idx], 0);
}
