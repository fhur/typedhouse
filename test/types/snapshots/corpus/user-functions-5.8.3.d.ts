export declare const userEditDistance: import("@chql/core").Query<{
    mpn: string;
    distance: bigint;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly distance: import("@chql/core").Expr<bigint, "distance", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
