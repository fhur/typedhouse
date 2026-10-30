export declare const projectionEnrichment: import("@chql/core").Query<{
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
    category: string;
    matched: bigint;
    mpns: (string | null)[];
    firstDesc: string | null;
    age: bigint;
    tier: string;
    source: string;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly part_specifications: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "part_specifications", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Array';
                inner: {
                    kind: 'Tuple';
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
                    }[] & ({
                        readonly name: "description";
                        readonly type: {
                            readonly kind: "Nullable";
                            readonly inner: {
                                readonly kind: "scalar";
                                readonly name: "String";
                            };
                        };
                    } | {
                        readonly name: "id";
                        readonly type: {
                            readonly kind: "scalar";
                            readonly name: "String";
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
                        readonly name: "mpn";
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
    readonly matched_part_ids: import("@chql/core").Expr<string[], "matched_part_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Array';
                inner: {
                    kind: 'scalar';
                    name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly category: import("@chql/core").Expr<string, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Array';
                inner: {
                    kind: 'Nullable';
                    inner: {
                        kind: 'scalar';
                        name: "String";
                    };
                };
            };
        };
    };
    readonly firstDesc: import("@chql/core").Expr<string | null, "firstDesc", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Nullable';
                inner: {
                    kind: 'scalar';
                    name: "String";
                };
            };
        };
    };
    readonly age: import("@chql/core").Expr<bigint, "age", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Int64";
            };
        };
    };
    readonly tier: import("@chql/core").Expr<string, "tier", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly source: import("@chql/core").Expr<string, "source", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
