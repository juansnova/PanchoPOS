import { PurchaseOrderStatus } from '../inventory.types';

const TRANSITION_TARGETS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus[]>> = {
  draft: ['submitted'],
  submitted: ['approved'],
};

/** Status changes exposed as primary buttons (Submit, Approve). */
export function purchaseOrderTransitionTargets(status: PurchaseOrderStatus): PurchaseOrderStatus[] {
  return TRANSITION_TARGETS[status] ?? [];
}

export function canReceivePurchaseOrder(status: PurchaseOrderStatus | undefined): boolean {
  return status === 'approved' || status === 'partially_received';
}

/** Cancel via DELETE for draft/submitted/approved; via status PUT for partially_received. */
export function canCancelPurchaseOrder(status: PurchaseOrderStatus | undefined): boolean {
  return (
    status === 'draft' ||
    status === 'submitted' ||
    status === 'approved' ||
    status === 'partially_received'
  );
}

export function cancelPurchaseOrderViaStatusEndpoint(status: PurchaseOrderStatus): boolean {
  return status === 'partially_received';
}

export function purchaseOrderActionLabelKey(target: PurchaseOrderStatus): string {
  switch (target) {
    case 'submitted':
      return 'INVENTORY.PURCHASE_ORDERS.ACTION_SUBMIT';
    case 'approved':
      return 'INVENTORY.PURCHASE_ORDERS.ACTION_APPROVE';
    default:
      return 'INVENTORY.PURCHASE_ORDERS.STATUS_' + target.toUpperCase();
  }
}
