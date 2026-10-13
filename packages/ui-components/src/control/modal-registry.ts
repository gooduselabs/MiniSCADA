// Chỉ một hộp xác nhận mở tại một thời điểm trong một màn hình (FR-037: OTHER_DIALOG).
// `layer` là phần tử chứa hộp (lớp phủ chung của nơi chứa); vắng thì hộp gắn vào document.body.
export class ModalRegistry {
  #holder: object | null = null;
  #listeners = new Set<() => void>();
  layer: HTMLElement | null = null;

  get holder(): object | null {
    return this.#holder;
  }

  /** Giành quyền mở hộp; false nếu hộp khác đang mở. Cùng chủ thì true. */
  acquire(owner: object): boolean {
    if (this.#holder && this.#holder !== owner) return false;
    if (this.#holder !== owner) {
      this.#holder = owner;
      this.#emit();
    }
    return true;
  }

  release(owner: object): void {
    if (this.#holder === owner) {
      this.#holder = null;
      this.#emit();
    }
  }

  /** Có hộp mở và chủ không phải `owner`. */
  blockedFor(owner: object): boolean {
    return this.#holder !== null && this.#holder !== owner;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #emit(): void {
    for (const l of [...this.#listeners]) l();
  }
}

/** Bản dùng chung khi nơi chứa không cấp riêng. */
export const defaultModalRegistry = new ModalRegistry();
