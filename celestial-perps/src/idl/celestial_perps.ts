/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/celestial_perps.json`.
 */
export type CelestialPerps = {
  "address": "EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL",
  "metadata": {
    "name": "celestialPerps",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Celestial Perps — pool-counterparty perpetuals on Solana"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "pendingAdmin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "addLiquidity",
      "discriminator": [
        181,
        157,
        89,
        67,
        143,
        182,
        52,
        72
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "clpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userClp",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "clpMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "minClp",
          "type": "u64"
        }
      ]
    },
    {
      "name": "addMarket",
      "discriminator": [
        41,
        137,
        185,
        126,
        69,
        139,
        254,
        55
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "symbol"
              }
            ]
          }
        },
        {
          "name": "oracle"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "oracleKind",
          "type": {
            "defined": {
              "name": "oracleKind"
            }
          }
        },
        {
          "name": "maxAge",
          "type": "u32"
        }
      ]
    },
    {
      "name": "cancelRequest",
      "discriminator": [
        65,
        196,
        177,
        247,
        83,
        151,
        33,
        130
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "request"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "executeRequest",
      "discriminator": [
        113,
        254,
        117,
        135,
        26,
        14,
        232,
        88
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "request.owner",
                "account": "request"
              },
              {
                "kind": "account",
                "path": "request.nonce",
                "account": "request"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "relations": [
            "request"
          ]
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "relations": [
            "request"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "faucet",
      "discriminator": [
        0,
        98,
        59,
        30,
        144,
        142,
        113,
        12
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "userUsdc",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "getAum",
      "discriminator": [
        49,
        62,
        85,
        68,
        236,
        71,
        123,
        222
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "getClpPrice",
      "discriminator": [
        44,
        73,
        32,
        154,
        173,
        34,
        26,
        247
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "clpMint",
          "relations": [
            "pool"
          ]
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "getLiquidationPrice",
      "discriminator": [
        73,
        174,
        119,
        65,
        149,
        5,
        73,
        239
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "position"
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.symbol",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "getMarketInfo",
      "discriminator": [
        92,
        128,
        144,
        97,
        233,
        21,
        219,
        247
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "market",
          "type": "pubkey"
        }
      ],
      "returns": {
        "defined": {
          "name": "marketInfo"
        }
      }
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "clpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "liquidate",
      "discriminator": [
        223,
        179,
        226,
        125,
        48,
        46,
        39,
        74
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "keeperUsdc",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "removeLiquidity",
      "discriminator": [
        80,
        85,
        209,
        72,
        24,
        206,
        177,
        108
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "clpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userClp",
          "writable": true
        },
        {
          "name": "userState",
          "docs": [
            "Created on the fly for holders who received CLP by transfer (never added liquidity)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clpAmount",
          "type": "u64"
        },
        {
          "name": "minUsdc",
          "type": "u64"
        }
      ]
    },
    {
      "name": "requestDecrease",
      "discriminator": [
        186,
        176,
        34,
        175,
        197,
        176,
        199,
        138
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.symbol",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position"
        },
        {
          "name": "userState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "isLong",
          "type": "bool"
        },
        {
          "name": "collateralDelta",
          "type": "u64"
        },
        {
          "name": "sizeDelta",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        },
        {
          "name": "executionFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "requestIncrease",
      "discriminator": [
        14,
        168,
        9,
        37,
        148,
        240,
        12,
        165
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "ownerUsdc",
          "writable": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.symbol",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position"
        },
        {
          "name": "userState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "isLong",
          "type": "bool"
        },
        {
          "name": "collateralDelta",
          "type": "u64"
        },
        {
          "name": "sizeDelta",
          "type": "u64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        },
        {
          "name": "executionFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setKeeper",
      "discriminator": [
        102,
        94,
        23,
        78,
        157,
        222,
        243,
        214
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "keeper",
          "type": "pubkey"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setMarketEnabled",
      "discriminator": [
        206,
        60,
        159,
        159,
        62,
        242,
        4,
        82
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.symbol",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setParams",
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "paramsUpdate"
            }
          }
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateFunding",
      "discriminator": [
        224,
        66,
        9,
        70,
        75,
        81,
        94,
        88
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "market",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawFees",
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "to",
          "writable": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "request",
      "discriminator": [
        125,
        172,
        150,
        161,
        162,
        115,
        39,
        71
      ]
    },
    {
      "name": "userState",
      "discriminator": [
        72,
        177,
        85,
        249,
        76,
        167,
        186,
        126
      ]
    }
  ],
  "events": [
    {
      "name": "faucetClaimed",
      "discriminator": [
        153,
        213,
        25,
        224,
        176,
        249,
        203,
        218
      ]
    },
    {
      "name": "feesAdded",
      "discriminator": [
        240,
        228,
        94,
        20,
        163,
        89,
        216,
        222
      ]
    },
    {
      "name": "feesWithdrawn",
      "discriminator": [
        234,
        15,
        0,
        119,
        148,
        241,
        40,
        21
      ]
    },
    {
      "name": "fundingUpdated",
      "discriminator": [
        206,
        76,
        89,
        81,
        126,
        37,
        255,
        224
      ]
    },
    {
      "name": "keeperUpdated",
      "discriminator": [
        66,
        246,
        222,
        123,
        98,
        93,
        174,
        230
      ]
    },
    {
      "name": "liquidityAdded",
      "discriminator": [
        154,
        26,
        221,
        108,
        238,
        64,
        217,
        161
      ]
    },
    {
      "name": "liquidityRemoved",
      "discriminator": [
        225,
        105,
        216,
        39,
        124,
        116,
        169,
        189
      ]
    },
    {
      "name": "marketEnabled",
      "discriminator": [
        63,
        128,
        245,
        222,
        253,
        172,
        186,
        84
      ]
    },
    {
      "name": "marketListed",
      "discriminator": [
        29,
        11,
        143,
        239,
        139,
        12,
        79,
        19
      ]
    },
    {
      "name": "paramUpdated",
      "discriminator": [
        68,
        86,
        14,
        131,
        209,
        66,
        199,
        122
      ]
    },
    {
      "name": "positionClosed",
      "discriminator": [
        157,
        163,
        227,
        228,
        13,
        97,
        138,
        121
      ]
    },
    {
      "name": "positionDecreased",
      "discriminator": [
        251,
        151,
        37,
        204,
        127,
        87,
        115,
        232
      ]
    },
    {
      "name": "positionIncreased",
      "discriminator": [
        73,
        58,
        247,
        181,
        100,
        237,
        249,
        81
      ]
    },
    {
      "name": "positionLiquidated",
      "discriminator": [
        40,
        107,
        90,
        214,
        96,
        30,
        61,
        128
      ]
    },
    {
      "name": "requestCancelled",
      "discriminator": [
        91,
        56,
        197,
        156,
        87,
        157,
        214,
        67
      ]
    },
    {
      "name": "requestCreated",
      "discriminator": [
        102,
        44,
        0,
        225,
        163,
        110,
        167,
        187
      ]
    },
    {
      "name": "requestExecuted",
      "discriminator": [
        254,
        115,
        238,
        135,
        55,
        132,
        6,
        62
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6001,
      "name": "divisionByZero",
      "msg": "Division by zero"
    },
    {
      "code": 6002,
      "name": "notAdmin",
      "msg": "Signer is not the admin"
    },
    {
      "code": 6003,
      "name": "notPendingAdmin",
      "msg": "Signer is not the pending admin"
    },
    {
      "code": 6004,
      "name": "notKeeper",
      "msg": "Signer is not a keeper"
    },
    {
      "code": 6005,
      "name": "keeperListFull",
      "msg": "Keeper list is full"
    },
    {
      "code": 6006,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6007,
      "name": "invalidParam",
      "msg": "Invalid parameter"
    },
    {
      "code": 6008,
      "name": "invalidSymbol",
      "msg": "Market symbol must be 1-16 bytes"
    },
    {
      "code": 6009,
      "name": "marketListFull",
      "msg": "Market list is full"
    },
    {
      "code": 6010,
      "name": "marketDisabled",
      "msg": "Market is disabled"
    },
    {
      "code": 6011,
      "name": "invalidMarketAccounts",
      "msg": "Remaining accounts must list every market and its oracle in config order"
    },
    {
      "code": 6012,
      "name": "oracleMismatch",
      "msg": "Oracle account does not match the market"
    },
    {
      "code": 6013,
      "name": "invalidOracleOwner",
      "msg": "Oracle account is not owned by the Chainlink store program"
    },
    {
      "code": 6014,
      "name": "invalidOracleData",
      "msg": "Oracle account data could not be decoded"
    },
    {
      "code": 6015,
      "name": "invalidOracleAnswer",
      "msg": "Oracle answer is not positive"
    },
    {
      "code": 6016,
      "name": "stalePrice",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6017,
      "name": "insufficientExecutionFee",
      "msg": "Execution fee below minimum"
    },
    {
      "code": 6018,
      "name": "emptyRequest",
      "msg": "Request is empty"
    },
    {
      "code": 6019,
      "name": "requestNotExpired",
      "msg": "Request has not expired yet"
    },
    {
      "code": 6020,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6021,
      "name": "slippage",
      "msg": "Slippage exceeded"
    },
    {
      "code": 6022,
      "name": "cooldownActive",
      "msg": "LP cooldown is active"
    },
    {
      "code": 6023,
      "name": "insufficientUnreservedLiquidity",
      "msg": "Not enough unreserved liquidity"
    },
    {
      "code": 6024,
      "name": "zeroAum",
      "msg": "Pool AUM is zero"
    },
    {
      "code": 6025,
      "name": "faucetCooldown",
      "msg": "Faucet cooldown is active"
    },
    {
      "code": 6026,
      "name": "notLiquidatable",
      "msg": "Position is not liquidatable"
    },
    {
      "code": 6027,
      "name": "positionNotFound",
      "msg": "Position does not exist"
    },
    {
      "code": 6028,
      "name": "noFees",
      "msg": "No fees to withdraw"
    },
    {
      "code": 6029,
      "name": "reserveExceedsPool",
      "msg": "Reserved amount would exceed pool amount"
    },
    {
      "code": 6030,
      "name": "insufficientPoolAmount",
      "msg": "Insufficient pool amount"
    },
    {
      "code": 6031,
      "name": "unsupportedOracleKind",
      "msg": "Oracle kind is not supported by this build"
    },
    {
      "code": 6032,
      "name": "invalidNonce",
      "msg": "Request nonce does not match the user's next nonce"
    },
    {
      "code": 6033,
      "name": "requestMismatch",
      "msg": "Account does not match the request"
    },
    {
      "code": 6034,
      "name": "invalidPosition",
      "msg": "Position account does not match the expected PDA"
    },
    {
      "code": 6035,
      "name": "marketNotWritable",
      "msg": "Market account must be writable"
    },
    {
      "code": 6036,
      "name": "zeroAddress",
      "msg": "Zero address"
    },
    {
      "code": 6037,
      "name": "insufficientRequestLamports",
      "msg": "Execution fee lamports missing from the request account"
    }
  ],
  "types": [
    {
      "name": "cancelReason",
      "docs": [
        "Why a request was cancelled during execution (emitted in `RequestCancelled.reason`).",
        "Mirrors the EVM custom errors that cause a cancel in `PerpEngine.executeRequests`."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "userCancelled"
          },
          {
            "name": "paused"
          },
          {
            "name": "marketDisabled"
          },
          {
            "name": "stalePrice"
          },
          {
            "name": "slippageExceeded"
          },
          {
            "name": "positionNotFound"
          },
          {
            "name": "sizeTooLarge"
          },
          {
            "name": "collateralTooLow"
          },
          {
            "name": "leverageTooLow"
          },
          {
            "name": "leverageTooHigh"
          },
          {
            "name": "openInterestCap"
          },
          {
            "name": "reserveCap"
          },
          {
            "name": "positionLiquidatable"
          },
          {
            "name": "insufficientCollateral"
          },
          {
            "name": "invalidPrice"
          },
          {
            "name": "insufficientPoolAmount"
          },
          {
            "name": "mathError"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global configuration and engine parameters (mirror of PerpEngine.sol state)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "keepers",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "markets",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "maxLeverage",
            "type": "u64"
          },
          {
            "name": "maintenanceMarginBps",
            "type": "u64"
          },
          {
            "name": "positionFeeBps",
            "type": "u64"
          },
          {
            "name": "liquidationFeeBps",
            "type": "u64"
          },
          {
            "name": "executionSpreadBps",
            "type": "u64"
          },
          {
            "name": "maxProfitMultiplier",
            "type": "u64"
          },
          {
            "name": "oiCapBps",
            "type": "u64"
          },
          {
            "name": "fundingFactorPerHour",
            "type": "u64"
          },
          {
            "name": "maxFundingRatePerHour",
            "type": "u64"
          },
          {
            "name": "requestExpiry",
            "type": "i64"
          },
          {
            "name": "minExecutionFeeLamports",
            "type": "u64"
          },
          {
            "name": "minCollateral",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mintAuthorityBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "faucetClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feesAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "toProtocol",
            "type": "u64"
          },
          {
            "name": "toPool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feesWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fundingUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "rateLongPerHour",
            "type": "u64"
          },
          {
            "name": "rateShortPerHour",
            "type": "u64"
          },
          {
            "name": "cumLong",
            "type": "u128"
          },
          {
            "name": "cumShort",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "keeperUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "liquidityAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "clpMinted",
            "type": "u64"
          },
          {
            "name": "aum",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "clpBurned",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          },
          {
            "name": "aum",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "oracleKind",
            "type": {
              "defined": {
                "name": "oracleKind"
              }
            }
          },
          {
            "name": "maxAge",
            "type": "u32"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "lastFundingTime",
            "type": "i64"
          },
          {
            "name": "longSize",
            "type": "u64"
          },
          {
            "name": "shortSize",
            "type": "u64"
          },
          {
            "name": "longTokens",
            "type": "u128"
          },
          {
            "name": "shortTokens",
            "type": "u128"
          },
          {
            "name": "longCollateral",
            "type": "u64"
          },
          {
            "name": "shortCollateral",
            "type": "u64"
          },
          {
            "name": "cumFundingLong",
            "type": "u128"
          },
          {
            "name": "cumFundingShort",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketEnabled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "marketInfo",
      "docs": [
        "View payload returned by `get_market_info`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "longSize",
            "type": "u64"
          },
          {
            "name": "shortSize",
            "type": "u64"
          },
          {
            "name": "longCapacity",
            "type": "u64"
          },
          {
            "name": "shortCapacity",
            "type": "u64"
          },
          {
            "name": "fundingRateLongPerHour",
            "type": "u64"
          },
          {
            "name": "fundingRateShortPerHour",
            "type": "u64"
          },
          {
            "name": "cumFundingLong",
            "type": "u128"
          },
          {
            "name": "cumFundingShort",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "marketListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "oracleKind",
      "docs": [
        "Where a market's price comes from. `Mock` is only readable when the program is built with",
        "the `mock-oracle` feature (local tests); the devnet build rejects it."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "chainlink"
          },
          {
            "name": "mock"
          }
        ]
      }
    },
    {
      "name": "paramUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "string"
          },
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paramsUpdate",
      "docs": [
        "Every field is optional; only the given ones change. Bounds are the EVM setter bounds."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxLeverage",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maintenanceMarginBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "positionFeeBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "liquidationFeeBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "executionSpreadBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxProfitMultiplier",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "oiCapBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "fundingFactorPerHour",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxFundingRatePerHour",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "requestExpiry",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "minExecutionFeeLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "minCollateral",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "lpMintFeeBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "protocolFeeShareBps",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "lpCooldown",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "pool",
      "docs": [
        "LP pool accounting. All USDC sits in one vault owned by this PDA."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "clpMint",
            "type": "pubkey"
          },
          {
            "name": "poolAmount",
            "type": "u64"
          },
          {
            "name": "reservedAmount",
            "type": "u64"
          },
          {
            "name": "feeReserves",
            "type": "u64"
          },
          {
            "name": "totalCollateral",
            "type": "u64"
          },
          {
            "name": "totalEscrow",
            "type": "u64"
          },
          {
            "name": "lpMintFeeBps",
            "type": "u64"
          },
          {
            "name": "protocolFeeShareBps",
            "type": "u64"
          },
          {
            "name": "lpCooldown",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "clpMintBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "tokens",
            "type": "u128"
          },
          {
            "name": "reserved",
            "type": "u64"
          },
          {
            "name": "entryFundingIndex",
            "type": "u128"
          },
          {
            "name": "lastUpdated",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "positionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "positionDecreased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "sizeDelta",
            "type": "u64"
          },
          {
            "name": "collateralOut",
            "type": "u64"
          },
          {
            "name": "executionPrice",
            "type": "u64"
          },
          {
            "name": "realisedPnl",
            "docs": [
              "Profit capped by the reserve; losses uncapped."
            ],
            "type": "i64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "fundingPaid",
            "type": "u64"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "positionIncreased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "sizeDelta",
            "type": "u64"
          },
          {
            "name": "collateralDelta",
            "type": "u64"
          },
          {
            "name": "executionPrice",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "fundingPaid",
            "type": "u64"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "entryPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "positionLiquidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "keeperFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "request",
      "docs": [
        "Pending order. Holds `execution_fee` (+ `position_rent`) lamports on top of its own rent;",
        "closed on execute/cancel."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "requestKind"
              }
            }
          },
          {
            "name": "collateralDelta",
            "type": "u64"
          },
          {
            "name": "sizeDelta",
            "type": "u64"
          },
          {
            "name": "acceptablePrice",
            "type": "u64"
          },
          {
            "name": "executionFee",
            "type": "u64"
          },
          {
            "name": "positionRent",
            "docs": [
              "Lamports prepaid by the trader for the `Position` account's rent (increase requests",
              "when the position does not exist yet); used to create it on execution, else refunded."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "requestCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "cancelReason"
              }
            }
          }
        ]
      }
    },
    {
      "name": "requestCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "requestKind"
              }
            }
          },
          {
            "name": "collateralDelta",
            "type": "u64"
          },
          {
            "name": "sizeDelta",
            "type": "u64"
          },
          {
            "name": "acceptablePrice",
            "type": "u64"
          },
          {
            "name": "executionFee",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "requestExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "requestKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "increase"
          },
          {
            "name": "decrease"
          }
        ]
      }
    },
    {
      "name": "userState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "requestNonce",
            "type": "u64"
          },
          {
            "name": "lastLpAddAt",
            "type": "i64"
          },
          {
            "name": "lastFaucetAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "clpMintSeed",
      "type": "bytes",
      "value": "[99, 108, 112, 95, 109, 105, 110, 116]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "marketSeed",
      "type": "bytes",
      "value": "[109, 97, 114, 107, 101, 116]"
    },
    {
      "name": "mintAuthoritySeed",
      "type": "bytes",
      "value": "[109, 105, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "mockOracleSeed",
      "type": "bytes",
      "value": "[109, 111, 99, 107, 95, 111, 114, 97, 99, 108, 101]"
    },
    {
      "name": "poolSeed",
      "type": "bytes",
      "value": "[112, 111, 111, 108]"
    },
    {
      "name": "positionSeed",
      "type": "bytes",
      "value": "[112, 111, 115, 105, 116, 105, 111, 110]"
    },
    {
      "name": "requestSeed",
      "type": "bytes",
      "value": "[114, 101, 113, 117, 101, 115, 116]"
    },
    {
      "name": "userSeed",
      "type": "bytes",
      "value": "[117, 115, 101, 114]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
