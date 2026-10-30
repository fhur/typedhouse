export declare const projectionEnrichment: import("@typedhouse/core").Query<{
    category: string;
    matched: bigint;
    mpns: (string | null)[];
    firstDesc: string | null;
    age: bigint;
    tier: string;
    source: string;
    tenantId: string;
    entityId: string;
    state: string;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    matched_part_ids: string[];
    countOfParts: bigint;
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly category: import("@typedhouse/core").Expr<string, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly mpns: import("@typedhouse/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Nullable";
                    inner: {
                        kind: "scalar";
                        name: "String";
                    };
                };
            };
        };
    };
    readonly firstDesc: import("@typedhouse/core").Expr<string | null, "firstDesc", "row"> & {
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
    readonly age: import("@typedhouse/core").Expr<bigint, "age", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Int64";
            };
        };
    };
    readonly tier: import("@typedhouse/core").Expr<string, "tier", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly source: import("@typedhouse/core").Expr<string, "source", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly part_specifications: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "part_specifications", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@typedhouse/core").CHType;
                    }[] & ({
                        readonly name: "id";
                        readonly type: {
                            readonly kind: "scalar";
                            readonly name: "String";
                        };
                    } | {
                        readonly name: "description";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    } | {
                        readonly name: "mpn";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    } | {
                        readonly name: "manufacturer";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    } | {
                        readonly name: "package";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    } | {
                        readonly name: "part_type";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    })[];
                };
            };
        };
    };
    readonly matched_part_ids: import("@typedhouse/core").Expr<string[], "matched_part_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
