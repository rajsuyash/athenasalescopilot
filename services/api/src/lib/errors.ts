/**
 * Stable error codes returned to clients. Keep in sync with PRD F8 / F10 error cases.
 * Code is a SCREAMING_SNAKE_CASE token; HTTP status is set by the route or the global handler.
 */
export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_EMAIL'
  | 'EMAIL_DOMAIN_BLOCKED'
  | 'EMAIL_TAKEN'
  | 'WEAK_PASSWORD'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'MISSING_WORKSPACE_CLAIM'
  | 'NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'INSUFFICIENT_ROLE'
  | 'MUST_HAVE_AT_LEAST_ONE_OWNER'
  | 'VERSION_CONFLICT'
  | 'RATE_LIMITED'
  | 'SEAT_LIMIT'
  | 'METERING_LIMIT'
  | 'PAYMENT_OVERDUE'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  invalidCredentials: () =>
    new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'),
  invalidEmail: () => new ApiError(400, 'INVALID_EMAIL', 'Email format is invalid.'),
  emailDomainBlocked: () =>
    new ApiError(
      400,
      'EMAIL_DOMAIN_BLOCKED',
      'Disposable email addresses are not allowed. Please use your work email.',
    ),
  emailTaken: () => new ApiError(409, 'EMAIL_TAKEN', 'Email is already registered.'),
  weakPassword: () =>
    new ApiError(422, 'WEAK_PASSWORD', 'Password must be at least 12 characters.'),
  tokenExpired: () => new ApiError(401, 'TOKEN_EXPIRED', 'Token has expired.'),
  tokenInvalid: () => new ApiError(401, 'TOKEN_INVALID', 'Token is invalid.'),
  missingWorkspaceClaim: () =>
    new ApiError(401, 'MISSING_WORKSPACE_CLAIM', 'Token has no workspace claim.'),
  notFound: () => new ApiError(404, 'NOT_FOUND', 'Resource not found.'),
  alreadyMember: () => new ApiError(409, 'ALREADY_MEMBER', 'User is already a member.'),
  insufficientRole: (required: string) =>
    new ApiError(403, 'INSUFFICIENT_ROLE', 'You do not have permission for this action.', {
      required,
    }),
  mustHaveOwner: () =>
    new ApiError(
      422,
      'MUST_HAVE_AT_LEAST_ONE_OWNER',
      'Workspace must retain at least one owner.',
    ),
  versionConflict: () =>
    new ApiError(409, 'VERSION_CONFLICT', 'Resource was modified concurrently.'),
} as const;
