import { Status } from "../enums/Status.js";

export type IStatusResponse<T = any> = {
  data: T;
  status: Status;
  error?: boolean
}

export const StatusResponse = <T = any>(data: T, status: Status = Status.GENERIC_SUCCESS, error: boolean = false): IStatusResponse<T> => ({
  data,
  status,
  error
})