export declare const filterTenantActive: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterCategory: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterMatched: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterPart: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterUpdated: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterCount: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterLifecycle: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterOrigin: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterYteol: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterPath: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const filterWarnings: import("@chql/core").Query<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly price_change_log_sum: import("@chql/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@chql/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index: import("@chql/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@chql/core").Expr<string[], "stock_index_warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lead_time_index_part_days: import("@chql/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@chql/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@chql/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const filterMembership: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const projectionFragment: import("@chql/core").Query<{
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
    readonly source: import("@chql/core").Expr<string, "source", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const cleanIndices: import("@chql/core").TableQuery<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
}, {
    live: false;
}, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
    readonly price_change_log_sum: import("@chql/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@chql/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index: import("@chql/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@chql/core").Expr<string[], "stock_index_warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lead_time_index_part_days: import("@chql/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@chql/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@chql/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
}>;
export declare const latestIndices: import("@chql/core").Query<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    stock_index_warnings: string[];
    lead_time_index_part_days: number;
    lead_time_index_part_count: number;
    lead_time_max_days: number | null;
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
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly price_change_log_sum: import("@chql/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@chql/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly stock_index: import("@chql/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly stock_index_warnings: import("@chql/core").Expr<string[], "stock_index_warnings", "row"> & {
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
    readonly lead_time_index_part_days: import("@chql/core").Expr<number, "lead_time_index_part_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_part_count: import("@chql/core").Expr<number, "lead_time_index_part_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly lead_time_max_days: import("@chql/core").Expr<number | null, "lead_time_max_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Nullable';
                inner: {
                    kind: 'scalar';
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const latestAvailability: import("@chql/core").Query<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    market_stock_total: number;
    market_stock_total_warnings: string[];
    market_stock_p50: number;
    market_stock_p50_warnings: string[];
    market_lead_time_p50_days: number;
    market_lead_time_p50_days_warnings: string[];
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
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly market_stock_total: import("@chql/core").Expr<number, "market_stock_total", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly market_stock_total_warnings: import("@chql/core").Expr<string[], "market_stock_total_warnings", "row"> & {
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
    readonly market_stock_p50: import("@chql/core").Expr<number, "market_stock_p50", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly market_stock_p50_warnings: import("@chql/core").Expr<string[], "market_stock_p50_warnings", "row"> & {
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
    readonly market_lead_time_p50_days: import("@chql/core").Expr<number, "market_lead_time_p50_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly market_lead_time_p50_days_warnings: import("@chql/core").Expr<string[], "market_lead_time_p50_days_warnings", "row"> & {
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
}, false>;
export declare const latestPartIndices: import("@chql/core").Query<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    price_change_log_sum: number;
    price_change_count: number;
    stock_index: number;
    lead_time_index_days: number;
    lead_time_index_count: number;
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
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly price_change_log_sum: import("@chql/core").Expr<number, "price_change_log_sum", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly price_change_count: import("@chql/core").Expr<number, "price_change_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly stock_index: import("@chql/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_days: import("@chql/core").Expr<number, "lead_time_index_days", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly lead_time_index_count: import("@chql/core").Expr<number, "lead_time_index_count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const latestPrices: import("@chql/core").Query<{
    tenantId: string;
    entityId: string;
    version: number;
    effectiveAt: Date;
    insertedAt: Date;
    market_unit_price_1k_p50: number;
    market_unit_price_1k_p50_warnings: string[];
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
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly insertedAt: import("@chql/core").Expr<Date, "insertedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly market_unit_price_1k_p50: import("@chql/core").Expr<number, "market_unit_price_1k_p50", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly market_unit_price_1k_p50_warnings: import("@chql/core").Expr<string[], "market_unit_price_1k_p50_warnings", "row"> & {
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
}, false>;
export declare const argMaxIndices: import("@chql/core").Query<{
    entityId: string;
    version: number;
    stockIndex: number;
    leadDays: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@chql/core").Expr<number | null, "leadDays", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Nullable';
                inner: {
                    kind: 'scalar';
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const weeklySeries: import("@chql/core").OrderedQuery<{
    week: Date;
    stock: number;
    leadDays: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Date";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly leadDays: import("@chql/core").Expr<number, "leadDays", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history: import("@chql/core").OrderedQuery<{
    entityId: string;
    at: Date;
    version: number;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'DateTime64';
                precision: 3;
                tz?: never;
            };
        };
    };
    readonly version: import("@chql/core").Expr<number, "version", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt32";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const scopedLatest: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    stock: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
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
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const total: import("@chql/core").Query<{
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@chql/core").Rel, {
        kind: 'Aggregate';
    }>;
};
export declare const stockShare: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    share: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Nullable';
                inner: {
                    kind: 'scalar';
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const perCategory: import("@chql/core").Query<{
    category: string;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly category: import("@chql/core").Expr<string, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryShare: import("@chql/core").Query<{
    entityId: string;
    share: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categories: import("@chql/core").Query<{
    category: string;
    components: bigint;
    stockIndex: number;
    leadTimeIndex: number;
    priceIndex: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly category: import("@chql/core").Expr<string, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly components: import("@chql/core").Expr<bigint, "components", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly leadTimeIndex: import("@chql/core").Expr<number, "leadTimeIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly priceIndex: import("@chql/core").Expr<number, "priceIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const manufacturers: import("@chql/core").OrderedQuery<{
    manufacturerId: string;
    manufacturerName: string;
    parts: bigint;
    stockIndex: number;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const tenantTotals: import("@chql/core").Query<{
    total: bigint;
    unmatched: bigint;
    categories: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly total: import("@chql/core").Expr<bigint, "total", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly unmatched: import("@chql/core").Expr<bigint, "unmatched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly categories: import("@chql/core").Expr<bigint, "categories", "row"> & {
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
export declare const singleCategory: import("@chql/core").Query<{
    category: string | null;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const singleWeek: import("@chql/core").Query<{
    effectiveAt: Date;
    stock_index: number;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly effectiveAt: import("@chql/core").Expr<Date, "effectiveAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Date";
            };
        };
    };
    readonly stock_index: import("@chql/core").Expr<number, "stock_index", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const singleManufacturer: import("@chql/core").Query<{
    manufacturerId: string;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
}, false>;
export declare const singleMembership: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const singleShare: import("@chql/core").Query<{
    stock: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly stock: import("@chql/core").Expr<number | null, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'Nullable';
                inner: {
                    kind: 'scalar';
                    name: "Float64";
                };
            };
        };
    };
}, false>;
export declare const componentParts: import("@chql/core").Query<{
    category: string | null;
    countOfParts: bigint;
    entityId: string;
    matched_part_ids: string[];
    partId: string;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    state: string;
    tenantId: string;
    updatedAt: Date;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: import("@chql/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false> & {
    readonly row: {
        readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "Nullable";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly state: import("@chql/core").Expr<string, "state", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: 'Tuple';
                        readonly items: ({
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "UInt64";
                };
            };
        };
        readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: 'DateTime64';
                    readonly precision: 3;
                } & {
                    readonly tz?: never;
                };
            };
        };
    } & {
        readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    kind: 'scalar';
                    name: import("@chql/core").ScalarName;
                } & {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
};
export declare const withParts: import("@chql/core").Query<{
    component: string;
    mpn: string;
    manufacturer: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly component: import("@chql/core").Expr<string, "component", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly manufacturer: import("@chql/core").Expr<string, "manufacturer", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
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
}, false>;
export declare const withPrice: import("@chql/core").Query<{
    component: string;
    mpn: string;
    price1k: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly component: import("@chql/core").Expr<string, "component", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly price1k: import("@chql/core").Expr<number, "price1k", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false>;
export declare const sharedPart: import("@chql/core").Query<{
    a: string;
    b: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly a: import("@chql/core").Expr<string, "a", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly b: import("@chql/core").Expr<string, "b", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
}, false>;
export declare const leftArray: import("@chql/core").Query<{
    category: string | null;
    countOfParts: bigint;
    entityId: string;
    matched_part_ids: string[];
    partId: string;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    state: string;
    tenantId: string;
    updatedAt: Date;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: import("@chql/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false> & {
    readonly row: {
        readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
        readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "Nullable";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly state: import("@chql/core").Expr<string, "state", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "String";
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: 'Tuple';
                        readonly items: ({
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
                    readonly kind: "Array";
                    readonly inner: {
                        readonly kind: "scalar";
                        readonly name: "String";
                    };
                };
            };
        };
        readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: "scalar";
                    readonly name: "UInt64";
                };
            };
        };
        readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    readonly kind: 'DateTime64';
                    readonly precision: 3;
                } & {
                    readonly tz?: never;
                };
            };
        };
    } & {
        readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
            readonly ir: import("@chql/core").ExprNode & {
                readonly type: {
                    kind: 'scalar';
                    name: import("@chql/core").ScalarName;
                } & {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
};
export declare const lowStock: import("@chql/core").Query<{
    category: string;
    components: bigint;
    stockIndex: number;
    leadTimeIndex: number;
    priceIndex: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly category: import("@chql/core").Expr<string, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly components: import("@chql/core").Expr<bigint, "components", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
    readonly stockIndex: import("@chql/core").Expr<number, "stockIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly leadTimeIndex: import("@chql/core").Expr<number, "leadTimeIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly priceIndex: import("@chql/core").Expr<number, "priceIndex", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const orderedComponents: import("@chql/core").Query<{
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
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const orderedNullable: import("@chql/core").OrderedQuery<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const orderedBare: import("@chql/core").OrderedQuery<{
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
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly manufacturerName: import("@chql/core").Expr<string, "manufacturerName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly partCategoryId: import("@chql/core").Expr<bigint | null, "partCategoryId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly partCategoryName: import("@chql/core").Expr<string | null, "partCategoryName", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly partCategoryPath: import("@chql/core").Expr<bigint[], "partCategoryPath", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Int64";
                };
            };
        };
    };
    readonly lifecycleStatus: import("@chql/core").Expr<string | null, "lifecycleStatus", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly lifecycleYteol: import("@chql/core").Expr<number | null, "lifecycleYteol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "Float64";
                };
            };
        };
    };
    readonly countryOfOrigin: import("@chql/core").Expr<string[], "countryOfOrigin", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly ipns: import("@chql/core").Expr<string[], "ipns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly supplier_ids: import("@chql/core").Expr<string[], "supplier_ids", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}, false>;
export declare const distinctManufacturer: import("@chql/core").Query<{
    manufacturerId: string;
}, import("@chql/core").ExpressionCaps<{
    live: false;
}>, {
    readonly manufacturerId: import("@chql/core").Expr<string, "manufacturerId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
}, false>;
export declare const entityUnion: import("@chql/core").Query<{
    entityId: string;
    kind: string;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
    readonly kind: import("@chql/core").Expr<string, "kind", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "String";
            };
        };
    };
}, true>;
export declare const sampleOnly: import("@chql/core").TableQuery<{
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
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
}>;
export declare const explicitCte: import("@chql/core").Query<{
    category: string | null;
    countOfParts: bigint;
    entityId: string;
    matched_part_ids: string[];
    partId: string;
    part_specifications: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    state: string;
    tenantId: string;
    updatedAt: Date;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly tenantId: import("@chql/core").Expr<string, "tenantId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "Nullable";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly state: import("@chql/core").Expr<string, "state", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "String";
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: 'Tuple';
                    readonly items: ({
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
                readonly kind: "Array";
                readonly inner: {
                    readonly kind: "scalar";
                    readonly name: "String";
                };
            };
        };
    };
    readonly countOfParts: import("@chql/core").Expr<bigint, "countOfParts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: "scalar";
                readonly name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                readonly kind: 'DateTime64';
                readonly precision: 3;
            } & {
                readonly tz?: never;
            };
        };
    };
} & {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: import("@chql/core").ScalarName;
            } & {
                readonly kind: "scalar";
                readonly name: "String";
            };
        };
    };
}, false>;
export declare const latestTotals: import("@chql/core").Query<{
    versions: bigint;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: 'scalar';
                name: "Float64";
            };
        };
    };
}, false> & {
    readonly ir: Extract<import("@chql/core").Rel, {
        kind: 'Aggregate';
    }>;
};
