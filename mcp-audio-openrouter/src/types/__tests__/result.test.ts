import { describe, expect, it } from 'vitest'
import type { Result } from '../result'
import { Err, Ok } from '../result'

describe('Result type', () => {
  describe('Result type narrowing', () => {
    it('should allow safe data access after success check', () => {
      const result: Result<{ value: number }, Error> = Ok({ value: 42 })

      if (result.success) {
        const doubled = result.data.value * 2
        expect(doubled).toBe(84)
      }
    })

    it('should allow safe error access after failure check', () => {
      const result: Result<string, Error> = Err(new Error('something went wrong'))

      if (!result.success) {
        expect(result.error.message).toContain('wrong')
      }
    })
  })

  describe('Result with custom error types', () => {
    it('should preserve custom error type information', () => {
      class ValidationError extends Error {
        constructor(
          message: string,
          public readonly field: string
        ) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      const result: Result<string, ValidationError> = Err(
        new ValidationError('Invalid value', 'email')
      )

      if (!result.success) {
        expect(result.error.field).toBe('email')
        expect(result.error.name).toBe('ValidationError')
      }
    })
  })

  describe('Result type guards', () => {
    it('should properly discriminate between success and error states', () => {
      const successResult: Result<string, Error> = Ok('success')
      const errorResult: Result<string, Error> = Err(new Error('failed'))

      if (successResult.success) {
        expect(successResult.data).toBe('success')
      }

      if (!errorResult.success) {
        expect(errorResult.error).toBeInstanceOf(Error)
      }
    })
  })

  describe('async Result operations', () => {
    it('should work with Promise<Result<T, E>>', async () => {
      const asyncOk = async (): Promise<Result<number, Error>> => {
        return Ok(42)
      }

      const asyncErr = async (): Promise<Result<number, Error>> => {
        return Err(new Error('async error'))
      }

      const okResult = await asyncOk()
      const errResult = await asyncErr()

      expect(okResult.success).toBe(true)
      if (okResult.success) {
        expect(okResult.data).toBe(42)
      }

      expect(errResult.success).toBe(false)
      if (!errResult.success) {
        expect(errResult.error.message).toBe('async error')
      }
    })
  })
})
