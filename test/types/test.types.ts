// Shared test type definitions

/**
 * Test case definition
 */
export interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

/**
 * Test result tracking
 */
export interface TestResult {
  passed: number;
  failed: number;
}

/**
 * Fleet creation response
 */
export interface FleetResponse {
  fleet: {
    id: string;
    name: string;
    deviceIds: string[];
    createdAt: string;
    updatedAt: string;
  };
}
