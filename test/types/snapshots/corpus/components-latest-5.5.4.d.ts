export declare const componentsLatest: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
    stockTotal: number;
    stockP50: number;
    leadDays: number;
    stockIndex: number;
    asOf: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly stockTotal: import("@typedhouse/core").Expr<number, "stockTotal", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockP50: import("@typedhouse/core").Expr<number, "stockP50", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@typedhouse/core").Expr<number, "leadDays", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockIndex: import("@typedhouse/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly asOf: import("@typedhouse/core").Expr<Date, "asOf", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const query: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
    stockTotal: number;
    stockP50: number;
    leadDays: number;
    stockIndex: number;
    asOf: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly stockTotal: import("@typedhouse/core").Expr<number, "stockTotal", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockP50: import("@typedhouse/core").Expr<number, "stockP50", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@typedhouse/core").Expr<number, "leadDays", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stockIndex: import("@typedhouse/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly asOf: import("@typedhouse/core").Expr<Date, "asOf", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
