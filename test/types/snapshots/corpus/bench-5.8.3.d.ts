export declare const componentPayload_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
                    }[] & {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_orderedPage: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const componentPayload_semiJoin: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const componentPayload_sharedCte: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
                    }[] & {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
                    }[] & {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    category: string | null;
    parts: {
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[];
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
    readonly parts: import("@chql/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@chql/core").CHType;
                    }[] & {
                        name?: string;
                        type: import("@chql/core").CHType;
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
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const partPayload_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_orderedPage: import("@chql/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const partPayload_semiJoin: import("@chql/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, true>;
export declare const partPayload_sharedCte: import("@chql/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@chql/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@chql/core").Expr<number | null, "years", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const partPayload_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const tupleExtraction_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_orderedPage: import("@chql/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const tupleExtraction_semiJoin: import("@chql/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const tupleExtraction_sharedCte: import("@chql/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpns: import("@chql/core").Expr<(string | null)[], "mpns", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
    readonly first: import("@chql/core").Expr<string | null, "first", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const tupleExtraction_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const matchedParts_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_orderedPage: import("@chql/core").Query<{
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const matchedParts_semiJoin: import("@chql/core").Query<{
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    partId: string;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, true>;
export declare const matchedParts_sharedCte: import("@chql/core").Query<{
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    partId: string;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const leftMatchedParts_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_orderedPage: import("@chql/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const leftMatchedParts_semiJoin: import("@chql/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const leftMatchedParts_sharedCte: import("@chql/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    partId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const componentPartJoin_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_orderedPage: import("@chql/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const componentPartJoin_semiJoin: import("@chql/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const componentPartJoin_sharedCte: import("@chql/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly mpn: import("@chql/core").Expr<string, "mpn", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly lifecycle: import("@chql/core").Expr<string | null, "lifecycle", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentPartJoin_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const priceJoin_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_orderedPage: import("@chql/core").Query<{
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const priceJoin_semiJoin: import("@chql/core").Query<{
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    price: number;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const priceJoin_sharedCte: import("@chql/core").Query<{
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const history_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_orderedPage: import("@chql/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const history_semiJoin: import("@chql/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const history_sharedCte: import("@chql/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    at: Date;
    stock: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly at: import("@chql/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const availabilityLatest_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const availabilityLatest_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const availabilityLatest_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const availabilityLatest_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const componentLatest_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const componentLatest_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, true>;
export declare const componentLatest_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const componentLatest_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const partLatest_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const partLatest_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const partLatest_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const priceLatest_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_orderedPage: import("@chql/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const priceLatest_semiJoin: import("@chql/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const priceLatest_sharedCte: import("@chql/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@chql/core").Expr<string[], "warnings", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, false>;
export declare const priceLatest_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const argMaxLatest_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const argMaxLatest_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, true>;
export declare const argMaxLatest_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@chql/core").Expr<number | null, "lead", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const argMaxLatest_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const weekly_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_orderedPage: import("@chql/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const weekly_semiJoin: import("@chql/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const weekly_sharedCte: import("@chql/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@chql/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@chql/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@chql/core").Expr<number, "median", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const versionTotals_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
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
export declare const versionTotals_orderedPage: import("@chql/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
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
export declare const versionTotals_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const versionTotals_semiJoin: import("@chql/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
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
export declare const versionTotals_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, true>;
export declare const versionTotals_sharedCte: import("@chql/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly versions: import("@chql/core").Expr<bigint, "versions", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warned: import("@chql/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const scalarShare_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_orderedPage: import("@chql/core").Query<{
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const scalarShare_semiJoin: import("@chql/core").Query<{
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    share: number | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Float64";
                };
            };
        };
    };
}, true>;
export declare const scalarShare_sharedCte: import("@chql/core").Query<{
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    share: number | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly share: import("@chql/core").Expr<number | null, "share", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const scalarShare_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const membership_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_orderedPage: import("@chql/core").Query<{
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const membership_semiJoin: import("@chql/core").Query<{
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    count: bigint;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const membership_sharedCte: import("@chql/core").Query<{
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    count: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@chql/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const entityUnion_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const entityUnion_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const entityUnion_orderedPage: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const entityUnion_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const entityUnion_semiJoin: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const entityUnion_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "String";
                };
            };
        };
    };
}, true>;
export declare const entityUnion_sharedCte: import("@chql/core").Query<{
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const entityUnion_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const entityUnion_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    category: string | null;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@chql/core").Expr<string | null, "category", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
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
export declare const entityUnion_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const manufacturerStock_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, true>;
export declare const manufacturerStock_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@chql/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@chql/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
export declare const categoryStock_project: import("@chql/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@chql/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_distinctFilter: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_orderedPage: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_groupCount: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: import("@chql/core").CHType;
        };
    };
}, false>;
export declare const categoryStock_semiJoin: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_repeatedUnion: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, {
    readonly live: false;
}, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const categoryStock_sharedCte: import("@chql/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_entityEnrichment: import("@chql/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@chql/core").Expr<bigint, "matched", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly updatedAt: import("@chql/core").Expr<Date, "updatedAt", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: string;
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_arrayEnrichment: import("@chql/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@chql/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly stock: import("@chql/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@chql/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@chql/core").Expr<number, "price", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_rollupShare: import("@chql/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<import("@chql/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@chql/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@chql/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@chql/core").ScalarName;
            } | {
                kind: "FixedString";
                n: number;
            } | {
                kind: "DateTime";
                tz?: string;
            } | {
                kind: "DateTime64";
                precision: number;
                tz?: string;
            } | {
                kind: "Decimal";
                precision: number;
                scale: number;
            } | {
                kind: "Enum";
                bits: 8 | 16;
                values: Array<{
                    name: string;
                    value: number;
                }>;
            } | {
                kind: "Nullable";
                inner: import("@chql/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Array";
                inner: import("@chql/core").CHType;
            } | {
                kind: "Map";
                key: import("@chql/core").CHType;
                value: import("@chql/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@chql/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@chql/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@chql/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@chql/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@chql/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@chql/core").ExprNode & {
            readonly type: NonNullable<import("@chql/core").CHType | null>;
        };
    };
}, false>;
