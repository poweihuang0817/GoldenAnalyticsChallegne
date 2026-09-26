// Shared logical function identities. No backend or SQL implementation belongs here.
export const FUNCTION_URI = 'https://github.com/poweihuang0817/GoldenAnalytics/blob/main/spec/golden-functions.yaml';
export const FUNCTIONS = ['equal', 'lower', 'is_null', 'is_not_null', 'and', 'multiply', 'subtract', 'divide', 'coalesce', 'sum', 'avg', 'count', 'percentile_cont'] as const;
