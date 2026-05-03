import { LoanStatus } from 'src/prisma/generated/enums';

export class LoanStateMachine {
  private static transitions: Record<LoanStatus, LoanStatus[]> = {
    PENDING: [LoanStatus.ACTIVE, LoanStatus.REJECTED],
    ACTIVE: [LoanStatus.COMPLETED],
    COMPLETED: [],
    REJECTED: [],
  };

  static canTransition(from: LoanStatus, to: LoanStatus) {
    const allowed = this.transitions[from] || [];
    return allowed.includes(to);
  }
}
