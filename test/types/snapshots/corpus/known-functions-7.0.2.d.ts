export declare const knownHash: import("@chql/core").Query<{
    h: bigint;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly h: import("@chql/core").Expr<bigint, "h", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const knownUnique: import("@chql/core").Query<{
    n: bigint;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly n: import("@chql/core").Expr<bigint, "n", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@chql/core").Rel, {
        kind: 'Aggregate';
    }>;
};
