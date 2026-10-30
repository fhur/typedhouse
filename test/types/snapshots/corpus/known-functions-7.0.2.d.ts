export declare const knownHash: import("@typedhouse/core").Query<{
    h: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly h: import("@typedhouse/core").Expr<bigint, "h", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const knownUnique: import("@typedhouse/core").Query<{
    n: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly n: import("@typedhouse/core").Expr<bigint, "n", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@typedhouse/core").Rel, {
        kind: 'Aggregate';
    }>;
};
