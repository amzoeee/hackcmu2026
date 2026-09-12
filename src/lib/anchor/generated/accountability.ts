/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/accountability.json`.
 */
export type Accountability = {
  "address": "EE5h4kXh8Pk2ECthCABpK7bLQ934n4TZjkRsuDgskYBb",
  "metadata": {
    "name": "accountability",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Accountability staking devnet prototype"
  },
  "instructions": [
    {
      "name": "createPot",
      "discriminator": [
        232,
        45,
        123,
        181,
        204,
        121,
        131,
        9
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "identifier"
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
          "name": "identifier",
          "type": "u64"
        },
        {
          "name": "task",
          "type": "string"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "judge",
          "type": "pubkey"
        },
        {
          "name": "accessHash",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "joinPot",
      "discriminator": [
        249,
        78,
        206,
        230,
        11,
        66,
        198,
        165
      ],
      "accounts": [
        {
          "name": "participant",
          "writable": true,
          "signer": true
        },
        {
          "name": "pot",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "accessCode",
          "type": {
            "option": "string"
          }
        }
      ]
    },
    {
      "name": "refundPot",
      "discriminator": [
        43,
        38,
        238,
        255,
        48,
        213,
        224,
        234
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "pot",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "setProfile",
      "docs": [
        "Creates or overwrites the display name for the signing wallet."
      ],
      "discriminator": [
        221,
        221,
        195,
        121,
        133,
        71,
        113,
        170
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
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
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "settlePot",
      "discriminator": [
        120,
        181,
        232,
        100,
        60,
        57,
        32,
        238
      ],
      "accounts": [
        {
          "name": "judge",
          "writable": true,
          "signer": true
        },
        {
          "name": "pot",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "completed",
          "type": "bool"
        }
      ]
    },
    {
      "name": "submitProof",
      "docs": [
        "The creator or any YES participant may link evidence until the pot is settled."
      ],
      "discriminator": [
        54,
        241,
        46,
        84,
        4,
        212,
        46,
        94
      ],
      "accounts": [
        {
          "name": "submitter",
          "signer": true
        },
        {
          "name": "pot",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "uri",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "pot",
      "discriminator": [
        238,
        118,
        60,
        175,
        178,
        191,
        59,
        58
      ]
    },
    {
      "name": "profile",
      "discriminator": [
        184,
        101,
        165,
        188,
        95,
        63,
        127,
        188
      ]
    }
  ],
  "events": [
    {
      "name": "ProofSubmitted",
      "discriminator": [
        160,
        51,
        85,
        70,
        249,
        89,
        5,
        139
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "taskRequired",
      "msg": "A task description is required."
    },
    {
      "code": 6001,
      "name": "taskTooLong",
      "msg": "The task description is too long."
    },
    {
      "code": 6002,
      "name": "invalidStake",
      "msg": "Stake must be greater than zero."
    },
    {
      "code": 6003,
      "name": "deadlineMustBeFuture",
      "msg": "The deadline must be in the future."
    },
    {
      "code": 6004,
      "name": "potSettled",
      "msg": "This pot is already settled."
    },
    {
      "code": 6005,
      "name": "deadlinePassed",
      "msg": "The deadline has passed."
    },
    {
      "code": 6006,
      "name": "potFull",
      "msg": "This pot already has the maximum number of participants."
    },
    {
      "code": 6007,
      "name": "alreadyParticipating",
      "msg": "This wallet has already joined the pot."
    },
    {
      "code": 6008,
      "name": "unauthorizedJudge",
      "msg": "Only the named judge may settle this pot."
    },
    {
      "code": 6009,
      "name": "deadlineNotReached",
      "msg": "The pot cannot be settled before its deadline."
    },
    {
      "code": 6010,
      "name": "incorrectRecipientCount",
      "msg": "The payout recipient count does not match the recorded participants."
    },
    {
      "code": 6011,
      "name": "recipientNotWritable",
      "msg": "A payout recipient must be writable."
    },
    {
      "code": 6012,
      "name": "invalidPayoutRecipient",
      "msg": "Payout recipients must exactly match the recorded participants."
    },
    {
      "code": 6013,
      "name": "settlementWindowExpired",
      "msg": "The judge's settlement window has expired. Anyone may refund this pot."
    },
    {
      "code": 6014,
      "name": "refundNotAvailable",
      "msg": "Refunds are available five minutes after the deadline."
    },
    {
      "code": 6015,
      "name": "invalidDeadline",
      "msg": "The deadline is too large to allow a settlement grace window."
    },
    {
      "code": 6016,
      "name": "invalidJudge",
      "msg": "The pot account cannot be its own judge."
    },
    {
      "code": 6017,
      "name": "insufficientPotBalance",
      "msg": "The pot cannot pay the recorded stakes while preserving rent."
    },
    {
      "code": 6018,
      "name": "unauthorizedProof",
      "msg": "Only the creator or a YES participant may submit proof."
    },
    {
      "code": 6019,
      "name": "proofRequired",
      "msg": "A proof link is required."
    },
    {
      "code": 6020,
      "name": "proofTooLong",
      "msg": "The proof link is too long."
    },
    {
      "code": 6021,
      "name": "accessCodeTooLong",
      "msg": "The invite code is too long."
    },
    {
      "code": 6022,
      "name": "invalidAccessCode",
      "msg": "The invite code is missing or incorrect."
    },
    {
      "code": 6023,
      "name": "nameRequired",
      "msg": "A display name is required."
    },
    {
      "code": 6024,
      "name": "nameTooLong",
      "msg": "The display name is too long."
    },
    {
      "code": 6025,
      "name": "proofAlreadySubmitted",
      "msg": "Only the creator may replace a proof link that is already recorded."
    }
  ],
  "types": [
    {
      "name": "ProofSubmitted",
      "docs": [
        "Only the newest proof link is stored; the log keeps the ones it replaced."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pot",
            "type": "pubkey"
          },
          {
            "name": "submitter",
            "type": "pubkey"
          },
          {
            "name": "uri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "pot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "judge",
            "type": "pubkey"
          },
          {
            "name": "identifier",
            "type": "u64"
          },
          {
            "name": "task",
            "type": "string"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "yesParticipants",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "noParticipants",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "outcome",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "proofUri",
            "type": "string"
          },
          {
            "name": "accessHash",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "profile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "settlementGraceSeconds",
      "type": "i64",
      "value": "300"
    }
  ]
};
