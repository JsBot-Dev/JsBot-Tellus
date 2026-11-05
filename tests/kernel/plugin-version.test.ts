import { describe, expect, it } from 'vitest'
import {
    compareVersions,
    isNewerVersion,
    isValidVersion,
} from '../../src/core/plugin/installer/version.js'

describe('plugin version comparison', () => {
    it('compares numeric release segments', () => {
        expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
        expect(compareVersions('2.0.1', '2.0.0')).toBe(1)
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
        expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    })

    it('orders prereleases before the matching release', () => {
        expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(-1)
        expect(compareVersions('2.0.0', '2.0.0-beta.1')).toBe(1)
        expect(compareVersions('2.0.0-beta.2', '2.0.0-beta.1')).toBe(1)
        expect(compareVersions('2.0.0-beta.10', '2.0.0-beta.2')).toBe(1)
        expect(compareVersions('2.0.0-beta', '2.0.0-beta.1')).toBe(-1)
    })

    it('ignores build metadata', () => {
        expect(compareVersions('1.2.3+build.2', '1.2.3+build.1')).toBe(0)
    })

    it('validates semver versions', () => {
        expect(isValidVersion('1.2.3')).toBe(true)
        expect(isValidVersion('v1.2.3')).toBe(true)
        expect(isValidVersion('1.2.3-beta.1+build.2')).toBe(true)
        expect(isValidVersion('latest')).toBe(false)
        expect(isValidVersion('1.2')).toBe(false)
        expect(isValidVersion('1.2.3.4')).toBe(false)
        expect(isValidVersion('')).toBe(false)
    })

    it('falls back to string comparison for non-semver versions', () => {
        expect(compareVersions('dev', '1.0.0')).toBeNull()
        expect(isNewerVersion('dev', '1.0.0')).toBe(true)
        expect(isNewerVersion('dev', 'dev')).toBe(false)
    })

    it('only reports a newer candidate as an update', () => {
        expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true)
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
        expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false)
        expect(isNewerVersion('2.0.0', '2.0.0-beta.1')).toBe(true)
    })
})
