/**
 * Tests for Logger utility
 * Covers structured logging, log levels, and sensitive data filtering
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '../logger'

const _mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
const _mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

describe('Logger', () => {
  let logger: Logger

  beforeEach(() => {
    vi.clearAllMocks()
    logger = new Logger()
  })

  describe('info logging', () => {
    it('should log info message with structured format', () => {
      const context = 'test-context'
      const message = 'Test info message'
      const metadata = { key: 'value', count: 42 }

      logger.info(context, message, metadata)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"level":"info"'))
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"context":"test-context"')
      )
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"metadata":{"key":"value","count":42}')
      )
    })
  })

  describe('warn logging', () => {
    it('should log warn message with structured format', () => {
      logger.warn('validation', 'Invalid input detected', { field: 'prompt' })

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"level":"warn"'))
    })
  })

  describe('error logging', () => {
    it('should log error message with error details', () => {
      const error = new Error('Network timeout')

      logger.error('api-call', 'API call failed', error, { endpoint: '/generate' })

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"level":"error"'))
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"errorMessage":"Network timeout"')
      )
    })
  })

  describe('sensitive data filtering', () => {
    it('should redact all sensitive field patterns', () => {
      const sensitiveFields = ['API_KEY', 'apiKey', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL']

      for (const field of sensitiveFields) {
        const metadata = { [field]: 'sensitive-value', normalField: 'normal-value' }

        logger.info('test', 'message', metadata)

        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"[REDACTED]"'))
        expect(mockConsoleError).toHaveBeenCalledWith(
          expect.not.stringContaining('sensitive-value')
        )
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('normal-value'))

        vi.clearAllMocks()
      }
    })

    it('should redact OPENROUTER_API_KEY in environment variable format', () => {
      const message = 'Starting service with OPENROUTER_API_KEY=sk-or-ABCDEF123456789'

      logger.info('config', message)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'))
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.not.stringContaining('sk-or-ABCDEF123456789')
      )
    })

    it('should redact URLs in log messages', () => {
      const message = 'Fetching data from https://api.example.com/v1/data?key=secret'

      logger.info('network', message)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('[URL_REDACTED]'))
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.not.stringContaining('https://api.example.com')
      )
    })

    it('should filter email addresses in log messages', () => {
      const message = 'Sending notification to user@example.com'

      logger.info('notification', message)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('[FILTERED]'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.not.stringContaining('user@example.com'))
    })
  })

  describe('debug logging', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
    })

    it('should log debug message in development mode', () => {
      process.env.NODE_ENV = 'development'

      logger.debug('debug-test', 'Debug message', { debug: true })

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"level":"debug"'))
    })

    it('should not log debug message in production mode', () => {
      process.env.NODE_ENV = 'production'

      logger.debug('debug-test', 'Debug message')

      expect(mockConsoleError).not.toHaveBeenCalled()
    })
  })

  describe('trace and session IDs', () => {
    it('should include traceId and sessionId in log entries', () => {
      logger.info('trace-test', 'Test message with trace')

      const logOutput = mockConsoleError.mock.calls[0]?.[0] as string
      const parsedLog = JSON.parse(logOutput)

      expect(parsedLog).toHaveProperty('traceId')
      expect(parsedLog).toHaveProperty('sessionId')
    })
  })

  describe('log entry structure', () => {
    it('should produce valid JSON log entries', () => {
      logger.info('json-test', 'Valid JSON test', { test: true, count: 1 })

      const logOutput = mockConsoleError.mock.calls[0]?.[0] as string
      expect(() => JSON.parse(logOutput)).not.toThrow()

      const parsedLog = JSON.parse(logOutput)
      expect(parsedLog).toMatchObject({
        timestamp: expect.any(String),
        level: 'info',
        context: 'json-test',
        message: 'Valid JSON test',
        metadata: { test: true, count: 1 },
      })
    })
  })
})
