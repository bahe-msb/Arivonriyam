export class AppError extends Error {
  status: number;
  stage: string;

  constructor(message: string, status: number, stage: string) {
    super(message);
    this.status = status;
    this.stage = stage;
  }
}
