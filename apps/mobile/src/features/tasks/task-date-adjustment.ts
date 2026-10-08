import type { ApiClient } from "../../api/onboarding-client";
import type { TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";

type CurrentTask = TaskDateAdjustmentComponents["schemas"]["CurrentTaskAdjustmentState"];
type Adjustment = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustment"];
type HistoryPage = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];

export class TaskDateAdjustmentError extends Error {
  constructor(message: string, readonly code: string, readonly current?: HistoryPage) {
    super(message);
    this.name = "TaskDateAdjustmentError";
  }
}

type UncertainCommand = Readonly<{
  taskId: string;
  baseTaskVersion: number;
  adjustmentId: string;
  newPlannedLocalDate: string;
}>;

function responseCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object" || !("code" in nested)) return undefined;
  return typeof (nested as { code: unknown }).code === "string" ? (nested as { code: string }).code : undefined;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTaskDateAdjustmentFlow(options: Readonly<{
  client: ApiClient;
  newAdjustmentId?: () => string;
}>) {
  const newAdjustmentId = options.newAdjustmentId ?? createId;
  const uncertain = new Map<string, UncertainCommand>();

  async function send(command: UncertainCommand): Promise<Adjustment> {
    let result;
    try {
      result = await options.client.POST("/tasks/{taskId}/date-adjustments", {
        params: { path: { taskId: command.taskId }, header: { "If-Match": String(command.baseTaskVersion) } },
        body: { adjustmentId: command.adjustmentId, newPlannedLocalDate: command.newPlannedLocalDate },
      });
    } catch {
      uncertain.set(command.taskId, command);
      throw new TaskDateAdjustmentError("Yanıt alınamadı. Aynı tarih değişikliği güvenle tekrar denenebilir.", "SUBMISSION_UNCERTAIN");
    }

    if (result.response.ok && result.error === undefined && result.data !== undefined) {
      uncertain.delete(command.taskId);
      return result.data as Adjustment;
    }

    const code = responseCode(result.error) ?? "ADJUSTMENT_REJECTED";
    uncertain.delete(command.taskId);
    let current: HistoryPage | undefined;
    if (result.response.status === 409) {
      try {
        const refreshed = await options.client.GET("/tasks/{taskId}/date-adjustments", { params: { path: { taskId: command.taskId } } });
        if (refreshed.response.ok && refreshed.error === undefined && refreshed.data !== undefined) current = refreshed.data as HistoryPage;
      } catch { /* The conflict remains explicit even if the follow-up read is unavailable. */ }
    }
    throw new TaskDateAdjustmentError(
      code === "NO_DATE_CHANGE" ? "Bu tarih görev için değişiklik oluşturmuyor." :
        code === "TASK_VERSION_CONFLICT" ? "Görev bilgisi değişti. Güncel tarihi kontrol edip yeniden karar verin." :
          "Tarih değişikliği kaydedilemedi. Güncel görev bilgisini kontrol edip yeniden deneyin.",
      code,
      current,
    );
  }

  return {
    hasUncertainSubmission(taskId: string): boolean { return uncertain.has(taskId); },
    async submit(taskId: string, task: CurrentTask, newPlannedLocalDate: string): Promise<Adjustment> {
      if (newPlannedLocalDate === task.plannedLocalDate) {
        throw new TaskDateAdjustmentError("Yeni tarih mevcut planlanan tarihle aynı.", "NO_DATE_CHANGE");
      }
      if (!task.adjustable) throw new TaskDateAdjustmentError("Bu görev için tarih değişikliği yapılamıyor.", "TASK_NOT_ACTIONABLE");
      const command = uncertain.get(taskId) ?? {
        taskId,
        baseTaskVersion: task.taskVersion,
        adjustmentId: newAdjustmentId(),
        newPlannedLocalDate,
      };
      if (command.newPlannedLocalDate !== newPlannedLocalDate || command.baseTaskVersion !== task.taskVersion) {
        throw new TaskDateAdjustmentError("Önce bekleyen tarih değişikliğini aynı seçimle tekrar deneyin.", "SUBMISSION_UNCERTAIN");
      }
      return send(command);
    },
    async retryUncertain(taskId: string): Promise<Adjustment> {
      const command = uncertain.get(taskId);
      if (!command) throw new TaskDateAdjustmentError("Tekrar denenecek tarih değişikliği yok.", "NO_UNCERTAIN_SUBMISSION");
      return send(command);
    },
  };
}
