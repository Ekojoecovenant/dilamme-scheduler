export interface WheelJob {
  id: string;
  scheduledAt: Date;
  createdAt: Date;
  priority: number;
  data: unknown;
}

interface WheelSlot {
  jobs: WheelJob[];
}

export class TimingWheel {
  private slots: WheelSlot[];
  private currentSlot: number = 0;
  private tickResolutionMs: number;
  private totalSlots: number;
  private startTime: number;

  constructor(totalSlots = 60, tickResolutionMs = 1000) {
    this.totalSlots = totalSlots;
    this.tickResolutionMs = tickResolutionMs;
    this.startTime = Date.now();
    this.slots = Array.from({ length: totalSlots }, () => ({ jobs: [] }));
  }

  insert(job: WheelJob): void {
    const now = Date.now();
    const delayMs = Math.max(0, job.scheduledAt.getTime() - now);
    const ticks = Math.floor(delayMs / this.tickResolutionMs);

    if (ticks >= this.totalSlots) {
      // job is too far in the future for this wheel's capacity
      // in a multi-level wheel this would overflow to the minutes wheel
      // for now place it at the furthest slot
      const slot = (this.currentSlot + this.totalSlots - 1) % this.totalSlots;
      this.slots[slot].jobs.push(job);
      return;
    }

    const targetSlot = (this.currentSlot + ticks) % this.totalSlots;
    this.slots[targetSlot].jobs.push(job);
  }

  // advance one tick, return all jobs due in this slot
  tick(): WheelJob[] {
    const due = this.slots[this.currentSlot].jobs;
    this.slots[this.currentSlot] = { jobs: [] };
    this.currentSlot = (this.currentSlot + 1) % this.totalSlots;
    return due;
  }

  // advance to current time, collecting all overdue jobs
  tickToNow(): WheelJob[] {
    const now = Date.now();
    const elapsed = now - this.startTime;
    const ticksElapsed = Math.floor(elapsed / this.tickResolutionMs);
    const ticksToAdvance = ticksElapsed - this.getTicksAdvanced();

    const due: WheelJob[] = [];
    for (let i = 0; i < ticksToAdvance; i++) {
      due.push(...this.tick());
    }
    return due;
  }

  private ticksAdvanced = 0;
  private getTicksAdvanced(): number {
    return this.ticksAdvanced;
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  getSlotCount(): number {
    return this.totalSlots;
  }

  getPendingCount(): number {
    return this.slots.reduce((sum, slot) => sum + slot.jobs.length, 0);
  }

  remove(id: string): boolean {
    for (const slot of this.slots) {
      const idx = slot.jobs.findIndex((j) => j.id === id);
      if (idx !== -1) {
        slot.jobs.splice(idx, 1);
        return true;
      }
    }
    return false;
  }
}