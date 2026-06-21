import { UserDetails } from './ISystemPromptBuilder';

export interface ISystemInstructionBuilder {
  /**
   * Generates the system instruction string based on registered tools and user details.
   */
  getSystemInstructions(useThinkMode?: boolean, userDetails?: UserDetails): string;
}
