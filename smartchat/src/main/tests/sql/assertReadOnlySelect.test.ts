import { describe, it, expect } from 'vitest'
import {
  findReadOnlyViolation,
  stripLiteralsAndComments,
  TOOL_READ_ONLY_POLICY,
  REPOSITORY_READ_ONLY_POLICY,
  assertReadOnlySelect
} from '../../services/messages/sql/assertReadOnlySelect'

describe('assertReadOnlySelect (shared guard)', () => {
  it('strips literals and comments', () => {
    expect(stripLiteralsAndComments("SELECT 'a DROP' -- DELETE\n/* x */")).toBe("SELECT ''  \n ")
  })

  it('classifies violations', () => {
    expect(findReadOnlyViolation('DELETE FROM t', TOOL_READ_ONLY_POLICY)).toEqual({ kind: 'not-select', original: 'DELETE FROM t' })
    expect(findReadOnlyViolation('SELECT 1; SELECT 2', REPOSITORY_READ_ONLY_POLICY)).toEqual({ kind: 'multiple-statements' })
    expect(findReadOnlyViolation('SELECT 1; SELECT 2', TOOL_READ_ONLY_POLICY)).toBeNull()
    expect(findReadOnlyViolation('WITH a AS (SELECT 1) DROP TABLE x', TOOL_READ_ONLY_POLICY)).toEqual({ kind: 'keyword', keyword: 'DROP' })
    expect(findReadOnlyViolation('WITH a AS (SELECT 1) REPLACE INTO x VALUES (1)', { ...TOOL_READ_ONLY_POLICY, forbiddenKeywords: [] }))
      .toEqual({ kind: 'pattern', label: 'REPLACE INTO' })
    expect(findReadOnlyViolation('SELECT 1', TOOL_READ_ONLY_POLICY)).toBeNull()
  })

  it('applies the prefix', () => {
    expect(() => assertReadOnlySelect('DROP TABLE x', TOOL_READ_ONLY_POLICY, '[X] ')).toThrow(/^\[X\] Query rejected/)
  })
})
