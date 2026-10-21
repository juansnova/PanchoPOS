"""
Inventory Service

Business logic for inventory management operations including:
- FIFO stock deduction
- Stock adjustments
- Purchase order receiving
- Recipe cost calculation
- Unit conversion
"""

from datetime import datetime, timezone
from decimal import Decimal

from sqlmodel import Session, select

from . import models
from .inventory_models import (
    InventoryBatch,
    InventoryItem,
    InventoryTransaction,
    ProductRecipe,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    TransactionType,
    UnitOfMeasure,
    Warehouse,
    WarehouseStock,
    convert_units,
    get_unit_type,
)


class InsufficientStockError(Exception):
    """Raised when there's not enough stock (warning only - allows negative)"""
    def __init__(self, item_name: str, required: Decimal, available: Decimal):
        self.item_name = item_name
        self.required = required
        self.available = available
        super().__init__(
            f"Low stock warning for {item_name}: needed {required}, available {available}"
        )


def get_or_create_default_warehouse(session: Session, tenant_id: int) -> Warehouse:
    """Return the tenant's default warehouse, creating 'Main' if missing."""
    statement = (
        select(Warehouse)
        .where(Warehouse.tenant_id == tenant_id)
        .where(Warehouse.is_deleted == False)
        .where(Warehouse.is_default == True)
    )
    warehouse = session.exec(statement).first()
    if warehouse:
        return warehouse

    # Prefer any existing active warehouse; otherwise create Main.
    any_wh = session.exec(
        select(Warehouse)
        .where(Warehouse.tenant_id == tenant_id)
        .where(Warehouse.is_deleted == False)
        .order_by(Warehouse.id)
    ).first()
    if any_wh:
        any_wh.is_default = True
        any_wh.updated_at = datetime.now(timezone.utc)
        session.add(any_wh)
        session.flush()
        return any_wh

    warehouse = Warehouse(
        tenant_id=tenant_id,
        name="Main",
        code="MAIN",
        is_default=True,
        is_active=True,
    )
    session.add(warehouse)
    session.flush()
    return warehouse


def resolve_warehouse(
    session: Session,
    tenant_id: int,
    warehouse_id: int | None,
) -> Warehouse:
    """Resolve warehouse_id or fall back to the tenant default. Validates tenant scope."""
    if warehouse_id is None:
        return get_or_create_default_warehouse(session, tenant_id)

    warehouse = session.get(Warehouse, warehouse_id)
    if (
        not warehouse
        or warehouse.tenant_id != tenant_id
        or warehouse.is_deleted
        or not warehouse.is_active
    ):
        raise ValueError("Warehouse not found or inactive")
    return warehouse


def adjust_warehouse_stock(
    session: Session,
    *,
    tenant_id: int,
    warehouse_id: int,
    inventory_item_id: int,
    delta: Decimal,
) -> WarehouseStock:
    """Apply a signed quantity delta to warehouse_stock (creates row if missing)."""
    statement = (
        select(WarehouseStock)
        .where(WarehouseStock.warehouse_id == warehouse_id)
        .where(WarehouseStock.inventory_item_id == inventory_item_id)
    )
    row = session.exec(statement).first()
    if not row:
        row = WarehouseStock(
            tenant_id=tenant_id,
            warehouse_id=warehouse_id,
            inventory_item_id=inventory_item_id,
            quantity=Decimal("0"),
        )
    row.quantity = (row.quantity or Decimal("0")) + delta
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    return row


def set_default_warehouse(
    session: Session,
    tenant_id: int,
    warehouse_id: int,
) -> Warehouse:
    """Mark one warehouse as default; clear is_default on siblings."""
    warehouse = session.get(Warehouse, warehouse_id)
    if not warehouse or warehouse.tenant_id != tenant_id or warehouse.is_deleted:
        raise ValueError("Warehouse not found")

    siblings = session.exec(
        select(Warehouse)
        .where(Warehouse.tenant_id == tenant_id)
        .where(Warehouse.is_deleted == False)
    ).all()
    now = datetime.now(timezone.utc)
    for sibling in siblings:
        sibling.is_default = sibling.id == warehouse_id
        sibling.updated_at = now
        session.add(sibling)
    session.flush()
    return warehouse


def generate_po_number(session: Session, tenant_id: int) -> str:
    """Generate unique PO number: PO-YYYYMMDD-XXXX"""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"PO-{today}-"
    
    # Find highest sequence for today
    statement = (
        select(PurchaseOrder)
        .where(PurchaseOrder.tenant_id == tenant_id)
        .where(PurchaseOrder.order_number.startswith(prefix))
        .order_by(PurchaseOrder.order_number.desc())
    )
    last_po = session.exec(statement).first()
    
    if last_po:
        try:
            last_seq = int(last_po.order_number.split("-")[-1])
            next_seq = last_seq + 1
        except ValueError:
            next_seq = 1
    else:
        next_seq = 1
    
    return f"{prefix}{next_seq:04d}"


def get_recipe_for_product(
    session: Session,
    product_id: int,
    tenant_id: int
) -> list[ProductRecipe]:
    """Get all recipe ingredients for a product"""
    statement = (
        select(ProductRecipe)
        .where(ProductRecipe.product_id == product_id)
        .where(ProductRecipe.tenant_id == tenant_id)
    )
    return list(session.exec(statement).all())


def convert_to_base_unit(
    quantity: Decimal,
    from_unit: UnitOfMeasure,
    item: InventoryItem
) -> Decimal:
    """Convert quantity to the item's base unit"""
    if from_unit == item.unit:
        return quantity
    return convert_units(quantity, from_unit, item.unit)


def deduct_from_batches_fifo(
    session: Session,
    inventory_item: InventoryItem,
    quantity_in_base_unit: Decimal,
    transaction_type: TransactionType,
    order_id: int | None = None,
    notes: str | None = None,
    created_by_id: int | None = None,
) -> list[InventoryTransaction]:
    """
    Deduct stock using FIFO from oldest batches.
    Allows negative stock (creates warning).
    Returns list of transactions created.
    """
    transactions = []
    remaining_to_deduct = quantity_in_base_unit
    
    # Get batches with remaining quantity, ordered by received_at (oldest first)
    statement = (
        select(InventoryBatch)
        .where(InventoryBatch.inventory_item_id == inventory_item.id)
        .where(InventoryBatch.quantity_remaining > 0)
        .order_by(InventoryBatch.received_at.asc())
    )
    batches = list(session.exec(statement).all())
    
    for batch in batches:
        if remaining_to_deduct <= 0:
            break
        
        # Amount to take from this batch
        take_from_batch = min(batch.quantity_remaining, remaining_to_deduct)
        
        # Update batch
        batch.quantity_remaining -= take_from_batch
        session.add(batch)
        
        # Create transaction for this batch usage
        new_balance = inventory_item.current_quantity - take_from_batch
        transaction = InventoryTransaction(
            tenant_id=inventory_item.tenant_id,
            inventory_item_id=inventory_item.id,
            batch_id=batch.id,
            transaction_type=transaction_type,
            quantity=-take_from_batch,  # Negative for deduction
            unit=inventory_item.unit,
            unit_cost_cents=batch.cost_per_unit_cents,
            total_cost_cents=int(take_from_batch * batch.cost_per_unit_cents),
            balance_after=new_balance,
            order_id=order_id,
            notes=notes,
            created_by_id=created_by_id,
        )
        session.add(transaction)
        transactions.append(transaction)
        
        # Update running balance
        inventory_item.current_quantity = new_balance
        remaining_to_deduct -= take_from_batch
    
    # If still have remaining to deduct (no more batches), allow negative stock
    if remaining_to_deduct > 0:
        new_balance = inventory_item.current_quantity - remaining_to_deduct
        transaction = InventoryTransaction(
            tenant_id=inventory_item.tenant_id,
            inventory_item_id=inventory_item.id,
            batch_id=None,  # No batch - negative stock
            transaction_type=transaction_type,
            quantity=-remaining_to_deduct,
            unit=inventory_item.unit,
            unit_cost_cents=inventory_item.average_cost_cents,  # Use average when no batch
            total_cost_cents=int(remaining_to_deduct * inventory_item.average_cost_cents),
            balance_after=new_balance,
            order_id=order_id,
            notes=f"{notes or ''} [NEGATIVE STOCK]".strip(),
            created_by_id=created_by_id,
        )
        session.add(transaction)
        transactions.append(transaction)
        inventory_item.current_quantity = new_balance
    
    session.add(inventory_item)
    return transactions


def _line_target_quantity(order_item) -> int:
    """Units of this line that should currently be deducted (0 once removed or cancelled)."""
    status = getattr(order_item.status, "value", order_item.status)
    if order_item.removed_by_customer or order_item.removed_by_user_id is not None or status == "cancelled":
        return 0
    return max(0, order_item.quantity or 0)


def deduct_inventory_for_order(
    session: Session,
    order: models.Order,
    tenant: models.Tenant,
    created_by_id: int | None = None,
) -> list[InventoryTransaction]:
    """
    Bring inventory in line with the order's lines, deducting only what is new.

    Each line remembers how many units were already deducted (``inventory_deducted_qty``), so calling
    this after every change is safe: added units are deducted (FIFO, negative stock allowed), and units
    of lines that were cancelled/removed/reduced are put back. Idempotent.
    """
    all_transactions: list[InventoryTransaction] = []

    for order_item in order.items:
        target = _line_target_quantity(order_item)
        delta = target - (order_item.inventory_deducted_qty or 0)
        if delta == 0:
            continue

        for ingredient in get_recipe_for_product(session, order_item.product_id, tenant.id):
            inv_item = session.get(InventoryItem, ingredient.inventory_item_id)
            if not inv_item or inv_item.is_deleted:
                continue

            waste_multiplier = 1 + (ingredient.waste_percentage / 100)
            quantity_needed = ingredient.quantity_required * abs(delta) * waste_multiplier

            if delta > 0:
                quantity_in_base = convert_to_base_unit(quantity_needed, ingredient.unit, inv_item)
                all_transactions.extend(
                    deduct_from_batches_fifo(
                        session=session,
                        inventory_item=inv_item,
                        quantity_in_base_unit=quantity_in_base,
                        transaction_type=TransactionType.sale,
                        order_id=order.id,
                        notes=f"Order #{order.id} - {order_item.product_name}",
                        created_by_id=created_by_id,
                    )
                )
            else:
                all_transactions.append(
                    adjust_stock(
                        session,
                        inv_item,
                        quantity_needed,
                        ingredient.unit,
                        TransactionType.adjustment_add,
                        notes=f"Order #{order.id} - {order_item.product_name} cancelled/reduced: stock returned",
                        created_by_id=created_by_id,
                    )
                )

        order_item.inventory_deducted_qty = target
        session.add(order_item)

    return all_transactions


def receive_goods(
    session: Session,
    purchase_order: PurchaseOrder,
    received_items: list[dict],  # [{purchase_order_item_id, quantity_received, unit_cost_cents?}]
    created_by_id: int,
    notes: str | None = None,
    warehouse_id: int | None = None,
) -> list[InventoryBatch]:
    """
    Receive goods against a Purchase Order.
    Creates inventory batches for FIFO tracking.
    Updates stock levels and PO status.
    Stock is attributed to warehouse_id (or the tenant default).
    """
    warehouse = resolve_warehouse(session, purchase_order.tenant_id, warehouse_id)
    batches_created = []
    all_fully_received = True
    
    for received in received_items:
        po_item = session.get(PurchaseOrderItem, received["purchase_order_item_id"])
        if not po_item or po_item.purchase_order_id != purchase_order.id:
            continue
        
        quantity_received = Decimal(str(received["quantity_received"]))
        unit_cost = received.get("unit_cost_cents") or po_item.unit_cost_cents
        
        # Update PO item received quantity
        po_item.quantity_received += quantity_received
        session.add(po_item)
        
        # Check if fully received
        if po_item.quantity_received < po_item.quantity_ordered:
            all_fully_received = False
        
        # Get the inventory item
        inv_item = session.get(InventoryItem, po_item.inventory_item_id)
        if not inv_item:
            continue
        
        # Convert received quantity to item's base unit
        quantity_in_base = convert_to_base_unit(
            quantity_received, po_item.unit, inv_item
        )
        # Convert cost to base unit cost
        if po_item.unit != inv_item.unit:
            conversion_factor = convert_units(
                Decimal("1"), po_item.unit, inv_item.unit
            )
            unit_cost_in_base = int(unit_cost / float(conversion_factor))
        else:
            unit_cost_in_base = unit_cost
        
        # Create batch for FIFO
        batch = InventoryBatch(
            tenant_id=purchase_order.tenant_id,
            inventory_item_id=inv_item.id,
            purchase_order_id=purchase_order.id,
            warehouse_id=warehouse.id,
            quantity_received=quantity_in_base,
            quantity_remaining=quantity_in_base,
            cost_per_unit_cents=unit_cost_in_base,
        )
        session.add(batch)
        session.flush()  # Get batch ID
        batches_created.append(batch)
        
        # Update inventory item stock
        old_quantity = inv_item.current_quantity
        new_quantity = old_quantity + quantity_in_base
        
        # Update weighted average cost
        if new_quantity > 0:
            total_old_value = old_quantity * inv_item.average_cost_cents
            total_new_value = quantity_in_base * unit_cost_in_base
            inv_item.average_cost_cents = int(
                (total_old_value + total_new_value) / new_quantity
            )
        
        inv_item.current_quantity = new_quantity
        inv_item.updated_at = datetime.now(timezone.utc)
        session.add(inv_item)

        adjust_warehouse_stock(
            session,
            tenant_id=purchase_order.tenant_id,
            warehouse_id=warehouse.id,
            inventory_item_id=inv_item.id,
            delta=quantity_in_base,
        )
        
        # Create transaction record
        transaction = InventoryTransaction(
            tenant_id=purchase_order.tenant_id,
            inventory_item_id=inv_item.id,
            batch_id=batch.id,
            warehouse_id=warehouse.id,
            transaction_type=TransactionType.purchase,
            quantity=quantity_in_base,  # Positive for addition
            unit=inv_item.unit,
            unit_cost_cents=unit_cost_in_base,
            total_cost_cents=int(quantity_in_base * unit_cost_in_base),
            balance_after=new_quantity,
            purchase_order_id=purchase_order.id,
            notes=notes or f"Received from PO {purchase_order.order_number}",
            created_by_id=created_by_id,
        )
        session.add(transaction)
    
    # Update PO status
    if all_fully_received:
        purchase_order.status = PurchaseOrderStatus.received
        purchase_order.received_date = datetime.now(timezone.utc)
    else:
        purchase_order.status = PurchaseOrderStatus.partially_received
    
    purchase_order.updated_at = datetime.now(timezone.utc)
    session.add(purchase_order)
    
    return batches_created


def adjust_stock(
    session: Session,
    inventory_item: InventoryItem,
    quantity: Decimal,
    unit: UnitOfMeasure,
    adjustment_type: TransactionType,
    notes: str | None = None,
    created_by_id: int | None = None,
    warehouse_id: int | None = None,
    reason: str | None = None,
) -> InventoryTransaction:
    """
    Manual stock adjustment (add, subtract, or record waste).
    Attributed to warehouse_id (or the tenant default).
    """
    warehouse = resolve_warehouse(session, inventory_item.tenant_id, warehouse_id)

    # Convert to base unit
    quantity_in_base = convert_to_base_unit(quantity, unit, inventory_item)
    
    if adjustment_type == TransactionType.adjustment_add:
        # Addition
        new_quantity = inventory_item.current_quantity + quantity_in_base
        transaction_quantity = quantity_in_base  # Positive
        warehouse_delta = quantity_in_base
    elif adjustment_type in (TransactionType.adjustment_subtract, TransactionType.waste):
        # Subtraction or waste
        new_quantity = inventory_item.current_quantity - quantity_in_base
        transaction_quantity = -quantity_in_base  # Negative
        warehouse_delta = -quantity_in_base
    else:
        raise ValueError(f"Invalid adjustment type: {adjustment_type}")
    
    # Update item
    inventory_item.current_quantity = new_quantity
    inventory_item.updated_at = datetime.now(timezone.utc)
    session.add(inventory_item)

    adjust_warehouse_stock(
        session,
        tenant_id=inventory_item.tenant_id,
        warehouse_id=warehouse.id,
        inventory_item_id=inventory_item.id,
        delta=warehouse_delta,
    )
    
    # Create transaction
    transaction = InventoryTransaction(
        tenant_id=inventory_item.tenant_id,
        inventory_item_id=inventory_item.id,
        batch_id=None,  # Manual adjustments don't use batches
        warehouse_id=warehouse.id,
        transaction_type=adjustment_type,
        quantity=transaction_quantity,
        unit=unit,
        unit_cost_cents=inventory_item.average_cost_cents,
        total_cost_cents=int(abs(quantity_in_base) * inventory_item.average_cost_cents),
        balance_after=new_quantity,
        notes=notes,
        reason=(reason or None),
        created_by_id=created_by_id,
    )
    session.add(transaction)
    
    return transaction


def calculate_product_cost(
    session: Session,
    product_id: int,
    tenant_id: int,
) -> dict:
    """
    Calculate theoretical cost of a product based on its recipe.
    Uses FIFO costing (oldest batch costs first).
    """
    recipe_items = get_recipe_for_product(session, product_id, tenant_id)
    
    if not recipe_items:
        return {
            "product_id": product_id,
            "ingredients": [],
            "total_cost_cents": 0,
        }
    
    ingredients_cost = []
    total_cost = 0
    
    for recipe_item in recipe_items:
        inv_item = session.get(InventoryItem, recipe_item.inventory_item_id)
        if not inv_item:
            continue
        
        # Convert recipe quantity to base unit
        quantity_in_base = convert_to_base_unit(
            recipe_item.quantity_required,
            recipe_item.unit,
            inv_item
        )
        
        # Apply waste factor
        waste_multiplier = 1 + (recipe_item.waste_percentage / 100)
        effective_quantity = quantity_in_base * waste_multiplier
        
        # Calculate cost using average (for simplicity in estimates)
        ingredient_cost = int(effective_quantity * inv_item.average_cost_cents)
        
        ingredients_cost.append({
            "inventory_item_id": inv_item.id,
            "name": inv_item.name,
            "quantity": float(recipe_item.quantity_required),
            "unit": recipe_item.unit.value,
            "waste_percentage": float(recipe_item.waste_percentage),
            "cost_cents": ingredient_cost,
        })
        
        total_cost += ingredient_cost
    
    return {
        "product_id": product_id,
        "ingredients": ingredients_cost,
        "total_cost_cents": total_cost,
    }


def calculate_fifo_valuation(
    session: Session,
    tenant_id: int,
) -> dict:
    """
    Calculate total inventory value using FIFO method.
    Returns detailed breakdown by item.
    """
    statement = (
        select(InventoryItem)
        .where(InventoryItem.tenant_id == tenant_id)
        .where(InventoryItem.is_deleted == False)
        .where(InventoryItem.is_active == True)
    )
    items = session.exec(statement).all()
    
    valuation_items = []
    total_value = 0
    
    for item in items:
        # Get remaining batches for this item
        batch_statement = (
            select(InventoryBatch)
            .where(InventoryBatch.inventory_item_id == item.id)
            .where(InventoryBatch.quantity_remaining > 0)
            .order_by(InventoryBatch.received_at.asc())
        )
        batches = session.exec(batch_statement).all()
        
        # Calculate value from batches (FIFO)
        item_value = 0
        for batch in batches:
            batch_value = int(batch.quantity_remaining * batch.cost_per_unit_cents)
            item_value += batch_value
        
        # If negative stock (no batches but quantity < 0), use average cost
        if item.current_quantity < 0:
            item_value = int(item.current_quantity * item.average_cost_cents)
        
        valuation_items.append({
            "inventory_item_id": item.id,
            "sku": item.sku,
            "name": item.name,
            "unit": item.unit.value,
            "quantity": float(item.current_quantity),
            "fifo_value_cents": item_value,
        })
        
        total_value += item_value
    
    return {
        "as_of_date": datetime.now(timezone.utc).isoformat(),
        "items": valuation_items,
        "total_value_cents": total_value,
    }


def get_low_stock_items(
    session: Session,
    tenant_id: int,
) -> list[InventoryItem]:
    """Get all items at or below reorder level"""
    statement = (
        select(InventoryItem)
        .where(InventoryItem.tenant_id == tenant_id)
        .where(InventoryItem.is_deleted == False)
        .where(InventoryItem.is_active == True)
        .where(InventoryItem.current_quantity <= InventoryItem.reorder_level)
    )
    return list(session.exec(statement).all())
