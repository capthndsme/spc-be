
/**
 * Sleep utility
 * @returns {Promise<void>}
 * 
 */
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
