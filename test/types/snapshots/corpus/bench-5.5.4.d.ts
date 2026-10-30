export declare const componentPayload_project: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@typedhouse/core").CHType;
                    }[] & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_distinctFilter: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_orderedPage: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const componentPayload_semiJoin: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_repeatedUnion: import("@typedhouse/core").Query<{
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const componentPayload_sharedCte: import("@typedhouse/core").Query<{
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@typedhouse/core").CHType;
                    }[] & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_entityEnrichment: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@typedhouse/core").CHType;
                    }[] & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_arrayEnrichment: import("@typedhouse/core").Query<{
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
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly parts: import("@typedhouse/core").Expr<{
        id: string;
        mpn: string | null;
        manufacturer: string | null;
        description: string | null;
        package: string | null;
        part_type: string | null;
    }[], "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "Tuple";
                    items: {
                        name?: string;
                        type: import("@typedhouse/core").CHType;
                    }[] & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const componentPayload_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const partPayload_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const partPayload_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
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
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
}, true>;
export declare const partPayload_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
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
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    category: bigint | null;
    path: bigint[];
    years: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly category: import("@typedhouse/core").Expr<bigint | null, "category", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Nullable";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly path: import("@typedhouse/core").Expr<bigint[], "path", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "Array";
                inner: {
                    kind: "scalar";
                    name: "Int64";
                };
            };
        };
    };
    readonly years: import("@typedhouse/core").Expr<number | null, "years", "row"> & {
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
export declare const partPayload_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const tupleExtraction_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const tupleExtraction_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
}, true>;
export declare const tupleExtraction_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    mpns: (string | null)[];
    first: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly first: import("@typedhouse/core").Expr<string | null, "first", "row"> & {
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
export declare const tupleExtraction_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const matchedParts_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
export declare const matchedParts_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
export declare const matchedParts_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const matchedParts_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
export declare const matchedParts_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, true>;
export declare const matchedParts_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
}, false>;
export declare const matchedParts_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    partId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
export declare const matchedParts_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
}, false>;
export declare const matchedParts_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const leftMatchedParts_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    partId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const leftMatchedParts_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const leftMatchedParts_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    partId: string;
    count: bigint;
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
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    partId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const leftMatchedParts_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const componentPartJoin_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const componentPartJoin_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
}, true>;
export declare const componentPartJoin_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    mpn: string;
    lifecycle: string | null;
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
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
export declare const componentPartJoin_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    mpn: string;
    lifecycle: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly mpn: import("@typedhouse/core").Expr<string, "mpn", "row"> & {
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
export declare const componentPartJoin_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const priceJoin_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const priceJoin_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const priceJoin_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const priceJoin_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const history_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    at: Date;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const history_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    at: Date;
    stock: number;
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
}, true>;
export declare const history_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    at: Date;
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    at: Date;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const history_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    at: Date;
    stock: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly at: import("@typedhouse/core").Expr<Date, "at", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "DateTime64";
                precision: 3;
                tz?: never;
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
export declare const history_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const availabilityLatest_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const availabilityLatest_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, true>;
export declare const availabilityLatest_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    warnings: string[];
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const availabilityLatest_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const componentLatest_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const componentLatest_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
}, true>;
export declare const componentLatest_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const componentLatest_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const partLatest_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const partLatest_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const partLatest_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number, "lead", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const partLatest_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const priceLatest_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const priceLatest_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, true>;
export declare const priceLatest_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    price: number;
    warnings: string[];
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    price: number;
    warnings: string[];
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly warnings: import("@typedhouse/core").Expr<string[], "warnings", "row"> & {
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
}, false>;
export declare const priceLatest_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const argMaxLatest_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const argMaxLatest_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
}, true>;
export declare const argMaxLatest_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    lead: number | null;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    lead: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly lead: import("@typedhouse/core").Expr<number | null, "lead", "row"> & {
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
export declare const argMaxLatest_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const weekly_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const weekly_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const weekly_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    week: Date;
    mean: number;
    median: number;
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    week: Date;
    mean: number;
    median: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly week: import("@typedhouse/core").Expr<Date, "week", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Date";
            };
        };
    };
    readonly mean: import("@typedhouse/core").Expr<number, "mean", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly median: import("@typedhouse/core").Expr<number, "median", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const weekly_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const versionTotals_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const versionTotals_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const versionTotals_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const versionTotals_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const versionTotals_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, true>;
export declare const versionTotals_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    versions: bigint;
    stock: number;
    warned: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly warned: import("@typedhouse/core").Expr<bigint, "warned", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const versionTotals_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const scalarShare_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    share: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
export declare const scalarShare_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    share: number | null;
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
export declare const scalarShare_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    share: number | null;
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
export declare const scalarShare_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const scalarShare_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    share: number | null;
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
export declare const scalarShare_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    share: number | null;
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
}, true>;
export declare const scalarShare_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    share: number | null;
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
export declare const scalarShare_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    share: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
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
export declare const scalarShare_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    share: number | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
export declare const scalarShare_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const membership_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const membership_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    count: bigint;
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, true>;
export declare const membership_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    count: bigint;
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    count: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly count: import("@typedhouse/core").Expr<bigint, "count", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
}, false>;
export declare const membership_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    live: false;
}>>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const entityUnion_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    category: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
}, false>;
export declare const entityUnion_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
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
}, true>;
export declare const entityUnion_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
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
}, true>;
export declare const entityUnion_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
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
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const entityUnion_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
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
}, true>;
export declare const entityUnion_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
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
}, true>;
export declare const entityUnion_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    category: string | null;
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
}, false>;
export declare const entityUnion_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    category: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
}, false>;
export declare const entityUnion_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    category: string | null;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
}, false>;
export declare const entityUnion_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
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
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const manufacturerStock_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
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
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
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
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
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
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const manufacturerStock_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, true>;
export declare const manufacturerStock_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    parts: bigint;
    eol: bigint;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly parts: import("@typedhouse/core").Expr<bigint, "parts", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly eol: import("@typedhouse/core").Expr<bigint, "eol", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
}, false>;
export declare const manufacturerStock_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
export declare const categoryStock_project: import("@typedhouse/core").Query<{
    labelled: boolean;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>, {
    readonly labelled: import("@typedhouse/core").Expr<boolean, "labelled", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Bool";
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_distinctFilter: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
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
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_orderedPage: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
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
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_groupCount: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: import("@typedhouse/core").CHType;
        };
    };
}, false>;
export declare const categoryStock_semiJoin: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
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
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_repeatedUnion: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, true>;
export declare const categoryStock_sharedCte: import("@typedhouse/core").Query<{
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_entityEnrichment: import("@typedhouse/core").Query<{
    matched: bigint;
    updatedAt: Date;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly matched: import("@typedhouse/core").Expr<bigint, "matched", "row"> & {
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
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_arrayEnrichment: import("@typedhouse/core").Query<{
    partId: string;
    entityId: string;
    stock: number;
    entities: bigint;
    price: number;
}, import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>, {
    readonly partId: import("@typedhouse/core").Expr<string, "partId", "row"> & {
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
    readonly stock: import("@typedhouse/core").Expr<number, "stock", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
    readonly entities: import("@typedhouse/core").Expr<bigint, "entities", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "UInt64";
            };
        };
    };
    readonly price: import("@typedhouse/core").Expr<number, "price", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "Float64";
            };
        };
    };
}, false>;
export declare const categoryStock_rollupShare: import("@typedhouse/core").Query<{
    entityId: string;
    occurrences: bigint;
    proportion: number | null;
}, import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<import("@typedhouse/core").ExpressionCaps<{
    readonly live: false;
}>>>, {
    readonly entityId: import("@typedhouse/core").Expr<string, "entityId", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: "String";
            };
        };
    };
    readonly occurrences: import("@typedhouse/core").Expr<bigint, "occurrences", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: {
                kind: "scalar";
                name: import("@typedhouse/core").ScalarName;
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
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "LowCardinality";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Array";
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Map";
                key: import("@typedhouse/core").CHType;
                value: import("@typedhouse/core").CHType;
            } | {
                kind: "Tuple";
                items: Array<{
                    name?: string;
                    type: import("@typedhouse/core").CHType;
                }>;
            } | {
                kind: "Variant";
                items: import("@typedhouse/core").CHType[];
            } | {
                kind: "Dynamic";
            } | {
                kind: "AggregateFunction";
                fn: string;
                args: import("@typedhouse/core").CHType[];
            } | {
                kind: "SimpleAggregateFunction";
                fn: string;
                inner: import("@typedhouse/core").CHType;
            } | {
                kind: "Unknown";
                raw: string;
            };
        };
    };
    readonly proportion: import("@typedhouse/core").Expr<number | null, "proportion", "row"> & {
        readonly ir: import("@typedhouse/core").ExprNode & {
            readonly type: NonNullable<import("@typedhouse/core").CHType | null>;
        };
    };
}, false>;
