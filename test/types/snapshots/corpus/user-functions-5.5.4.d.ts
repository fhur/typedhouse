export declare const userEditDistance: import("@typedhouse/core").Query<{
    mpn: string;
    distance: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly distance: import("@typedhouse/core").Expr<bigint, "distance", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
