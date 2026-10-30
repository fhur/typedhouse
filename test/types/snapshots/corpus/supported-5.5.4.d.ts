export declare const filterTenantActive: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterCategory: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterMatched: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterPart: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterUpdated: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterCount: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterLifecycle: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterOrigin: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterYteol: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterPath: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterWarnings: import("@typedhouse/core").Query<{
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly price_change_log_sum: import("@typedhouse/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@typedhouse/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index: import("@typedhouse/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@typedhouse/core").Expr<string[], "stock_index_warnings", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lead_time_index_part_days: import("@typedhouse/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@typedhouse/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@typedhouse/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterMembership: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const projectionFragment: import("@typedhouse/core").Query<{
    category: string;
    matched: bigint;
    mpns: (string | null)[];
    firstDesc: string | null;
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
export declare const cleanIndices: import("@typedhouse/core").TableQuery<{
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, {
    live: false;
}, {
    readonly price_change_log_sum: import("@typedhouse/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@typedhouse/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index: import("@typedhouse/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@typedhouse/core").Expr<string[], "stock_index_warnings", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lead_time_index_part_days: import("@typedhouse/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@typedhouse/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@typedhouse/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}>;
export declare const latestIndices: import("@typedhouse/core").Query<{
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly price_change_log_sum: import("@typedhouse/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@typedhouse/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stock_index: import("@typedhouse/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@typedhouse/core").Expr<string[], "stock_index_warnings", "row"> & {
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
    readonly lead_time_index_part_days: import("@typedhouse/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@typedhouse/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@typedhouse/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
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
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const latestAvailability: import("@typedhouse/core").Query<{
    market_stock_total: number;
    market_stock_total_warnings: string[];
    market_stock_p50: number;
    market_stock_p50_warnings: string[];
    market_lead_time_p50_days: number;
    market_lead_time_p50_days_warnings: string[];
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly market_stock_total: import("@typedhouse/core").Expr<number, "market_stock_total", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly market_stock_total_warnings: import("@typedhouse/core").Expr<string[], "market_stock_total_warnings", "row"> & {
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
    readonly market_stock_p50: import("@typedhouse/core").Expr<number, "market_stock_p50", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly market_stock_p50_warnings: import("@typedhouse/core").Expr<string[], "market_stock_p50_warnings", "row"> & {
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
    readonly market_lead_time_p50_days: import("@typedhouse/core").Expr<number, "market_lead_time_p50_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly market_lead_time_p50_days_warnings: import("@typedhouse/core").Expr<string[], "market_lead_time_p50_days_warnings", "row"> & {
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
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const latestPartIndices: import("@typedhouse/core").Query<{
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    lead_time_index_days: number;
    lead_time_index_count: number;
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly price_change_log_sum: import("@typedhouse/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@typedhouse/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly stock_index: import("@typedhouse/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_days: import("@typedhouse/core").Expr<number, "lead_time_index_days", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_count: import("@typedhouse/core").Expr<number, "lead_time_index_count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
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
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const latestPrices: import("@typedhouse/core").Query<{
    market_unit_price_1k_p50: number;
    market_unit_price_1k_p50_warnings: string[];
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly market_unit_price_1k_p50: import("@typedhouse/core").Expr<number, "market_unit_price_1k_p50", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly market_unit_price_1k_p50_warnings: import("@typedhouse/core").Expr<string[], "market_unit_price_1k_p50_warnings", "row"> & {
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
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@typedhouse/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
}, false>;
export declare const argMaxIndices: import("@typedhouse/core").Query<{
    entityId: string;
    version: number;
    stockIndex: number;
    leadDays: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
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
    readonly leadDays: import("@typedhouse/core").Expr<number | null, "leadDays", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const weeklySeries: import("@typedhouse/core").OrderedQuery<{
    week: Date;
    stock: number;
    leadDays: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
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
}, false>;
export declare const history: import("@typedhouse/core").OrderedQuery<{
    entityId: string;
    at: Date;
    version: number;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly version: import("@typedhouse/core").Expr<number, "version", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt32";
            };
        };
    };
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const scopedLatest: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
    stock: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const total: import("@typedhouse/core").Query<{
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@typedhouse/core").Rel, {
        kind: "Aggregate";
    }>;
};
export declare const stockShare: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    share: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly share: import("@typedhouse/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const perCategory: import("@typedhouse/core").Query<{
    category: string;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly category: import("@typedhouse/core").Expr<string, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryShare: import("@typedhouse/core").Query<{
    entityId: string;
    share: number;
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
    readonly share: import("@typedhouse/core").Expr<number, "share", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categories: import("@typedhouse/core").Query<{
    category: string;
    components: bigint;
    stockIndex: number;
    leadTimeIndex: number;
    priceIndex: number;
    warned: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly category: import("@typedhouse/core").Expr<string, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly components: import("@typedhouse/core").Expr<bigint, "components", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
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
    readonly leadTimeIndex: import("@typedhouse/core").Expr<number, "leadTimeIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly priceIndex: import("@typedhouse/core").Expr<number, "priceIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const manufacturers: import("@typedhouse/core").OrderedQuery<{
    manufacturerId: string;
    manufacturerName: string;
    parts: bigint;
    stockIndex: number;
    eol: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
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
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const tenantTotals: import("@typedhouse/core").Query<{
    total: bigint;
    unmatched: bigint;
    categories: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly total: import("@typedhouse/core").Expr<bigint, "total", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly unmatched: import("@typedhouse/core").Expr<bigint, "unmatched", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly categories: import("@typedhouse/core").Expr<bigint, "categories", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@typedhouse/core").Rel, {
        kind: "Aggregate";
    }>;
};
export declare const singleCategory: import("@typedhouse/core").Query<{
    category: string | null;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const singleWeek: import("@typedhouse/core").Query<{
    effectiveAt: Date;
    stock_index: number;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly effectiveAt: import("@typedhouse/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly stock_index: import("@typedhouse/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const singleManufacturer: import("@typedhouse/core").Query<{
    manufacturerId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const singleMembership: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const singleShare: import("@typedhouse/core").Query<{
    stock: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly stock: import("@typedhouse/core").Expr<number | null, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const componentParts: import("@typedhouse/core").Query<{
    state: string;
    tenantId: string;
    entityId: string;
    category: string | null;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    matched_part_ids: string[];
    updatedAt: Date;
    countOfParts: bigint;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false> & {
    readonly row: {
        readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "Nullable";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "Tuple";
                        readonly items: ({
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "UInt64";
                };
            };
        };
        readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "DateTime64";
                    readonly precision: 3;
                } & {
                    readonly tz?: never;
                };
            };
        };
    } & {
        readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    kind: "scalar";
                    name: import("@typedhouse/core").ScalarName;
                } & {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
};
export declare const withParts: import("@typedhouse/core").Query<{
    component: string;
    mpn: string;
    manufacturer: string;
    lifecycle: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly component: import("@typedhouse/core").Expr<string, "component", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly manufacturer: import("@typedhouse/core").Expr<string, "manufacturer", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@typedhouse/core").Expr<string | null, "lifecycle", "row"> & {
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
}, false>;
export declare const withPrice: import("@typedhouse/core").Query<{
    component: string;
    mpn: string;
    price1k: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly component: import("@typedhouse/core").Expr<string, "component", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price1k: import("@typedhouse/core").Expr<number, "price1k", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const sharedPart: import("@typedhouse/core").Query<{
    a: string;
    b: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly a: import("@typedhouse/core").Expr<string, "a", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly b: import("@typedhouse/core").Expr<string, "b", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const leftArray: import("@typedhouse/core").Query<{
    state: string;
    tenantId: string;
    entityId: string;
    category: string | null;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    matched_part_ids: string[];
    updatedAt: Date;
    countOfParts: bigint;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false> & {
    readonly row: {
        readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "Nullable";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "Tuple";
                        readonly items: ({
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "UInt64";
                };
            };
        };
        readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    readonly kind: "DateTime64";
                    readonly precision: 3;
                } & {
                    readonly tz?: never;
                };
            };
        };
    } & {
        readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
            readonly ir: import("@typedhouse/core").ExprNode & {
                readonly type: {
                    kind: "scalar";
                    name: import("@typedhouse/core").ScalarName;
                } & {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
};
export declare const lowStock: import("@typedhouse/core").Query<{
    category: string;
    components: bigint;
    stockIndex: number;
    leadTimeIndex: number;
    priceIndex: number;
    warned: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly category: import("@typedhouse/core").Expr<string, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly components: import("@typedhouse/core").Expr<bigint, "components", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
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
    readonly leadTimeIndex: import("@typedhouse/core").Expr<number, "leadTimeIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly priceIndex: import("@typedhouse/core").Expr<number, "priceIndex", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const orderedComponents: import("@typedhouse/core").Query<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const orderedNullable: import("@typedhouse/core").OrderedQuery<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const orderedBare: import("@typedhouse/core").OrderedQuery<{
    tenantId: string;
    entityId: string;
    manufacturerId: string;
    manufacturerName: string;
    mpn: string;
    partCategoryId: bigint | null;
    partCategoryName: string | null;
    partCategoryPath: bigint[];
    lifecycleStatus: string | null;
    lifecycleYteol: number | null;
    countryOfOrigin: string[];
    ipns: string[];
    supplier_ids: string[];
    updatedAt: Date;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@typedhouse/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@typedhouse/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@typedhouse/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@typedhouse/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@typedhouse/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@typedhouse/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@typedhouse/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@typedhouse/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@typedhouse/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const distinctManufacturer: import("@typedhouse/core").Query<{
    manufacturerId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>, {
    readonly manufacturerId: import("@typedhouse/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const entityUnion: import("@typedhouse/core").Query<{
    entityId: string;
    kind: string;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly kind: import("@typedhouse/core").Expr<string, "kind", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, true>;
export declare const sampleOnly: import("@typedhouse/core").TableQuery<{
    tenantId: string;
    entityId: string;
    category: string | null;
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
}, {
    live: false;
}, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}>;
export declare const explicitCte: import("@typedhouse/core").Query<{
    state: string;
    tenantId: string;
    entityId: string;
    category: string | null;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    matched_part_ids: string[];
    updatedAt: Date;
    countOfParts: bigint;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@typedhouse/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@typedhouse/core").Expr<string, "state", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "Tuple";
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@typedhouse/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@typedhouse/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                readonly kind: "DateTime64";
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false>;
export declare const latestTotals: import("@typedhouse/core").Query<{
    versions: bigint;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly versions: import("@typedhouse/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@typedhouse/core").Rel, {
        kind: "Aggregate";
    }>;
};
