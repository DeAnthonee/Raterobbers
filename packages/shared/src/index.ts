/**
 * @eyespy/shared — deterministic game rules.
 *
 * Everything here must be free of DOM and Node dependencies so the same code
 * runs on the server (authoritative) and in the client (display/prediction),
 * and so the whole ruleset is unit-testable without a browser.
 */
export const SHARED_VERSION = '0.1.0';

export * from './types';
export * from './config';
export * from './rng';
export * from './grid';
export * from './map';
export * from './templates/format';
export * from './templates/symmetry';
export * from './templates/validate';
export * from './templates/library';
export * from './state';
export * from './match';
export * from './sim';
export * from './wire';
