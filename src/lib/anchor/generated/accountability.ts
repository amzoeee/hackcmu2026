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
    }
  ],
  "types": [
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
  ]
};
