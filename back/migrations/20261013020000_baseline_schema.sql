-- Migration 20261013020000: baseline schema
-- Description: squashed baseline replacing the 136 historical migrations that preceded it.
-- Pancho Panza is still pre-launch (no first official release yet), so there is no reason
-- to keep replaying a year's worth of incremental SaaS-era migrations on every fresh deploy.
-- This file is the full current schema (generated via `pg_dump --schema-only`), minus the
-- `schema_version` bookkeeping table itself and two orphaned enum types that no column
-- referenced anymore (hubfulfillmentstatus, productquestiontype — leftovers from already-
-- removed features). A brand-new empty database runs this one file and ends up with exactly
-- the schema this deployment runs on. Do not edit old migrations after this point either —
-- start a new timestamped file as usual.

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: businesstype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.businesstype AS ENUM (
    'restaurant',
    'bar',
    'cafe',
    'retail',
    'service',
    'other'
);



--
-- Name: inventorycategory; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inventorycategory AS ENUM (
    'ingredients',
    'beverages',
    'packaging',
    'cleaning',
    'equipment',
    'other'
);


--
-- Name: orderchannel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.orderchannel AS ENUM (
    'table',
    'satisfecho_delivery',
    'marketplace'
);


--
-- Name: orderitemstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.orderitemstatus AS ENUM (
    'pending',
    'preparing',
    'ready',
    'delivered',
    'cancelled'
);


--
-- Name: orderstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.orderstatus AS ENUM (
    'pending',
    'preparing',
    'ready',
    'out_for_delivery',
    'partially_delivered',
    'paid',
    'completed',
    'cancelled'
);



--
-- Name: purchaseorderstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.purchaseorderstatus AS ENUM (
    'draft',
    'submitted',
    'approved',
    'partially_received',
    'received',
    'cancelled'
);


--
-- Name: reservationstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reservationstatus AS ENUM (
    'booked',
    'seated',
    'finished',
    'cancelled',
    'no_show'
);


--
-- Name: staff_contract_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.staff_contract_kind AS ENUM (
    'employee',
    'freelancer'
);


--
-- Name: staff_contract_payment_structure; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.staff_contract_payment_structure AS ENUM (
    'payroll',
    'invoice'
);


--
-- Name: staff_contract_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.staff_contract_status AS ENUM (
    'draft',
    'pending_signature',
    'active',
    'expired',
    'superseded'
);


--
-- Name: transactiontype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.transactiontype AS ENUM (
    'purchase',
    'sale',
    'adjustment_add',
    'adjustment_subtract',
    'waste',
    'transfer_in',
    'transfer_out'
);


--
-- Name: unitofmeasure; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.unitofmeasure AS ENUM (
    'piece',
    'gram',
    'kilogram',
    'ounce',
    'pound',
    'milliliter',
    'centiliter',
    'liter',
    'fluid_ounce',
    'cup',
    'gallon'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'owner',
    'kitchen',
    'waiter',
    'courier'
);


--
-- Name: waitingliststatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waitingliststatus AS ENUM (
    'waiting',
    'notified',
    'seated',
    'cancelled',
    'no_show'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: billing_customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_customer (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying NOT NULL,
    company_name character varying,
    tax_id character varying,
    address character varying,
    email character varying,
    phone character varying,
    birth_date date,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: billing_customer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_customer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_customer_id_seq OWNED BY public.billing_customer.id;


--
-- Name: delivery_catalog_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_catalog_mapping (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    integration_id integer NOT NULL,
    external_item_id character varying(256) NOT NULL,
    product_id integer,
    notes character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: delivery_catalog_mapping_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_catalog_mapping_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_catalog_mapping_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_catalog_mapping_id_seq OWNED BY public.delivery_catalog_mapping.id;


--
-- Name: delivery_integration_event_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_integration_event_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    integration_id integer,
    provider_key character varying(64) NOT NULL,
    event_type character varying(64) NOT NULL,
    summary text,
    detail jsonb,
    success boolean NOT NULL,
    error_message text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: delivery_integration_event_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_integration_event_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_integration_event_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_integration_event_log_id_seq OWNED BY public.delivery_integration_event_log.id;


--
-- Name: delivery_marketplace_integration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_marketplace_integration (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    provider_key character varying(64) NOT NULL,
    connection_status character varying(32) NOT NULL,
    credentials_encrypted text,
    external_store_id character varying(256),
    enabled boolean NOT NULL,
    webhook_ingest_token character varying(64) NOT NULL,
    last_test_at timestamp with time zone,
    last_test_ok boolean,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: delivery_marketplace_integration_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_marketplace_integration_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_marketplace_integration_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_marketplace_integration_id_seq OWNED BY public.delivery_marketplace_integration.id;


--
-- Name: dian_invoice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dian_invoice (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    order_id integer NOT NULL,
    mode character varying(16) NOT NULL,
    status character varying(32) NOT NULL,
    document_type character varying(16) NOT NULL,
    provider_invoice_number character varying(64),
    cufe character varying(128),
    pdf_url text,
    xml_url text,
    amount_cents integer NOT NULL,
    request_payload jsonb,
    response_payload jsonb,
    provider character varying(32) NOT NULL,
    submission_status character varying(32) NOT NULL,
    error_message text,
    cancels_dian_invoice_id integer,
    issued_at timestamp with time zone NOT NULL,
    submitted_at timestamp with time zone,
    CONSTRAINT dian_invoice_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['invoice'::character varying, 'credit_note'::character varying])::text[])))
);


--
-- Name: dian_invoice_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dian_invoice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dian_invoice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dian_invoice_id_seq OWNED BY public.dian_invoice.id;


--
-- Name: floor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.floor (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean NOT NULL,
    seating_zone character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    default_waiter_id integer
);


--
-- Name: COLUMN floor.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.floor.is_active IS 'When false, floor is hidden from public booking zone list (e.g. closed terrace).';


--
-- Name: COLUMN floor.seating_zone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.floor.seating_zone IS 'Reservation zone type: indoor, outdoor, or any (matches both indoor and terrace preferences).';


--
-- Name: floor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.floor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: floor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.floor_id_seq OWNED BY public.floor.id;


--
-- Name: guest_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_feedback (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    rating integer NOT NULL,
    comment character varying,
    contact_name character varying(200),
    contact_email character varying(320),
    contact_phone character varying(40),
    reservation_id integer,
    client_ip character varying(45),
    client_user_agent character varying(512)
);


--
-- Name: guest_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guest_feedback_id_seq OWNED BY public.guest_feedback.id;


--
-- Name: i18ntext; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.i18ntext (
    id integer NOT NULL,
    tenant_id integer,
    entity_type character varying NOT NULL,
    entity_id integer NOT NULL,
    field character varying NOT NULL,
    lang character varying NOT NULL,
    text character varying NOT NULL
);


--
-- Name: i18ntext_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.i18ntext_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: i18ntext_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.i18ntext_id_seq OWNED BY public.i18ntext.id;


--
-- Name: inventory_batch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_batch (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    inventory_item_id integer NOT NULL,
    purchase_order_id integer,
    warehouse_id integer,
    batch_number character varying,
    received_at timestamp with time zone NOT NULL,
    quantity_received numeric(12,4) NOT NULL,
    quantity_remaining numeric(12,4) NOT NULL,
    cost_per_unit_cents integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_batch_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_batch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_batch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_batch_id_seq OWNED BY public.inventory_batch.id;


--
-- Name: inventory_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_item (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    sku character varying NOT NULL,
    name character varying NOT NULL,
    description character varying,
    unit public.unitofmeasure NOT NULL,
    reorder_level numeric(12,4) NOT NULL,
    reorder_quantity numeric(12,4) NOT NULL,
    current_quantity numeric(12,4) NOT NULL,
    average_cost_cents integer NOT NULL,
    category public.inventorycategory NOT NULL,
    default_supplier_id integer,
    is_active boolean NOT NULL,
    is_deleted boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_item_id_seq OWNED BY public.inventory_item.id;


--
-- Name: inventory_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transaction (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    inventory_item_id integer NOT NULL,
    batch_id integer,
    transaction_type public.transactiontype NOT NULL,
    quantity numeric(12,4) NOT NULL,
    unit public.unitofmeasure NOT NULL,
    unit_cost_cents integer,
    total_cost_cents integer,
    balance_after numeric(12,4) NOT NULL,
    order_id integer,
    purchase_order_id integer,
    warehouse_id integer,
    notes character varying,
    created_by_id integer,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_transaction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_transaction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_transaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_transaction_id_seq OWNED BY public.inventory_transaction.id;


--
-- Name: kitchen_station; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kitchen_station (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(128) NOT NULL,
    sort_order integer NOT NULL,
    display_route character varying(16) NOT NULL
);


--
-- Name: TABLE kitchen_station; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kitchen_station IS 'Prep station for KDS filtering and product routing (kitchen vs bar display)';


--
-- Name: COLUMN kitchen_station.display_route; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.kitchen_station.display_route IS 'kitchen = /kitchen KDS, bar = /bar KDS';


--
-- Name: kitchen_station_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kitchen_station_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kitchen_station_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kitchen_station_id_seq OWNED BY public.kitchen_station.id;


--
-- Name: offline_order_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offline_order_idempotency (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    idempotency_key character varying(64) NOT NULL,
    order_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: offline_order_idempotency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.offline_order_idempotency_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: offline_order_idempotency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.offline_order_idempotency_id_seq OWNED BY public.offline_order_idempotency.id;


--
-- Name: opening_hours_baseline_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opening_hours_baseline_schedule (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    effective_from date NOT NULL,
    opening_hours text NOT NULL,
    note character varying(512),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: opening_hours_baseline_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opening_hours_baseline_schedule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opening_hours_baseline_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opening_hours_baseline_schedule_id_seq OWNED BY public.opening_hours_baseline_schedule.id;


--
-- Name: opening_hours_date_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opening_hours_date_override (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    date_from date NOT NULL,
    date_to date NOT NULL,
    closed boolean NOT NULL,
    opening_hours text,
    note character varying(512),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: opening_hours_date_override_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opening_hours_date_override_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opening_hours_date_override_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opening_hours_date_override_id_seq OWNED BY public.opening_hours_date_override.id;


--
-- Name: order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."order" (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    table_id integer,
    status public.orderstatus NOT NULL,
    notes character varying,
    session_id character varying,
    customer_name character varying,
    billing_customer_id integer,
    created_at timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by character varying,
    bill_requested_at timestamp with time zone,
    paid_at timestamp with time zone,
    paid_by_user_id integer,
    payment_method character varying,
    revolut_order_id character varying,
    tip_percent_applied integer,
    tip_amount_cents integer,
    tip_attributed_user_id integer,
    location_verified boolean,
    flagged_for_review boolean NOT NULL,
    flag_reason character varying,
    deleted_at timestamp with time zone,
    deleted_by_user_id integer,
    staff_urgent boolean NOT NULL,
    delivery_integration_id integer,
    external_order_ref character varying(256),
    order_channel public.orderchannel NOT NULL,
    delivery_address text,
    customer_phone character varying(40),
    courier_user_id integer,
    delivery_fee_cents integer NOT NULL
);


--
-- Name: COLUMN "order".delivery_fee_cents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".delivery_fee_cents IS 'Delivery fee snapshot at create time (Satisfecho Delivery)';


--
-- Name: order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_id_seq OWNED BY public."order".id;


--
-- Name: order_payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_payment (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    order_id integer NOT NULL,
    amount_cents integer NOT NULL,
    payment_method character varying(32) NOT NULL,
    payer_label character varying(120),
    tip_amount_cents integer,
    stripe_payment_intent_id character varying(128),
    paid_by_user_id integer,
    paid_at timestamp with time zone NOT NULL,
    voided_at timestamp with time zone,
    note character varying(500)
);


--
-- Name: order_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_payment_id_seq OWNED BY public.order_payment.id;


--
-- Name: order_payment_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_payment_item (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    order_payment_id integer NOT NULL,
    order_item_id integer NOT NULL,
    amount_cents integer NOT NULL
);


--
-- Name: order_payment_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_payment_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_payment_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_payment_item_id_seq OWNED BY public.order_payment_item.id;


--
-- Name: orderitem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orderitem (
    id integer NOT NULL,
    order_id integer NOT NULL,
    product_id integer NOT NULL,
    product_name character varying NOT NULL,
    quantity integer NOT NULL,
    price_cents integer NOT NULL,
    cost_cents integer,
    notes character varying,
    line_modifiers jsonb,
    line_modifiers_summary character varying(1024),
    list_price_cents integer,
    discount_cents integer NOT NULL,
    promo_id integer,
    promo_snapshot jsonb,
    tax_id integer,
    tax_rate_percent integer,
    tax_amount_cents integer,
    status public.orderitemstatus NOT NULL,
    status_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    prepared_by_user_id integer,
    delivered_by_user_id integer,
    removed_by_customer boolean NOT NULL,
    removed_at timestamp with time zone,
    removed_reason character varying,
    removed_by_user_id integer,
    modified_by_user_id integer,
    modified_at timestamp with time zone,
    cancelled_reason character varying,
    added_by_session character varying,
    location_flagged boolean NOT NULL,
    inventory_deducted_qty integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN orderitem.line_modifiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orderitem.line_modifiers IS 'Structured modifiers: remove[], add[], substitute[{from,to}]';


--
-- Name: COLUMN orderitem.line_modifiers_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orderitem.line_modifiers_summary IS 'Human-readable snapshot at order time';


--
-- Name: orderitem_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orderitem_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orderitem_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orderitem_id_seq OWNED BY public.orderitem.id;


--
-- Name: price_promotion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_promotion (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    promo_type character varying(32) NOT NULL,
    percent_off integer NOT NULL,
    category character varying(120) NOT NULL,
    channels jsonb,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    days_of_week jsonb,
    start_time_local character varying(5),
    end_time_local character varying(5),
    stackable boolean NOT NULL,
    enabled boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: price_promotion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_promotion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_promotion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_promotion_id_seq OWNED BY public.price_promotion.id;


--
-- Name: print_agent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_agent (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    device_id character varying(64) NOT NULL,
    display_name character varying(120) NOT NULL,
    token_hash character varying(64) NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: print_agent_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.print_agent_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: print_agent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.print_agent_id_seq OWNED BY public.print_agent.id;


--
-- Name: print_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_job (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    job_type character varying(16) NOT NULL,
    printer_role character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    order_id integer,
    payload jsonb NOT NULL,
    created_by_user_id integer,
    claimed_by_agent_id integer,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message character varying(500),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: print_job_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.print_job_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: print_job_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.print_job_id_seq OWNED BY public.print_job.id;


--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying NOT NULL,
    price_cents integer NOT NULL,
    cost_cents integer,
    description character varying,
    image_filename character varying,
    ingredients character varying,
    category character varying,
    subcategory character varying,
    tax_id integer,
    available_from date,
    available_until date,
    kitchen_station_id integer,
    stock_alert_enabled boolean NOT NULL,
    stock_qty integer NOT NULL,
    stock_alert_level integer NOT NULL
);


--
-- Name: COLUMN product.kitchen_station_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.kitchen_station_id IS 'Explicit prep station; null uses tenant default by category/route';


--
-- Name: product_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_id_seq OWNED BY public.product.id;


--
-- Name: product_recipe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_recipe (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    product_id integer NOT NULL,
    inventory_item_id integer NOT NULL,
    quantity_required numeric(12,4) NOT NULL,
    unit public.unitofmeasure NOT NULL,
    waste_percentage numeric(5,2) NOT NULL,
    notes character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: product_recipe_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_recipe_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_recipe_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_recipe_id_seq OWNED BY public.product_recipe.id;


--
-- Name: productcatalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.productcatalog (
    id integer NOT NULL,
    name character varying NOT NULL,
    description character varying,
    category character varying,
    subcategory character varying,
    barcode character varying,
    brand character varying,
    normalized_name character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: productcatalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.productcatalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: productcatalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.productcatalog_id_seq OWNED BY public.productcatalog.id;


--
-- Name: provider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider (
    id integer NOT NULL,
    tenant_id integer,
    name character varying NOT NULL,
    token character varying NOT NULL,
    url character varying,
    api_endpoint character varying,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    full_company_name character varying,
    address character varying,
    tax_number character varying,
    phone character varying,
    email character varying,
    bank_iban character varying,
    bank_bic character varying,
    bank_name character varying,
    bank_account_holder character varying
);


--
-- Name: provider_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provider_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provider_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provider_id_seq OWNED BY public.provider.id;


--
-- Name: providerproduct; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providerproduct (
    id integer NOT NULL,
    catalog_id integer NOT NULL,
    provider_id integer NOT NULL,
    external_id character varying NOT NULL,
    name character varying NOT NULL,
    price_cents integer,
    image_url character varying,
    image_filename character varying,
    availability boolean NOT NULL,
    country character varying,
    region character varying,
    grape_variety character varying,
    volume_ml integer,
    unit character varying,
    wine_category_id character varying,
    detailed_description character varying,
    wine_style character varying,
    vintage integer,
    winery character varying,
    aromas character varying,
    elaboration character varying,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: providerproduct_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.providerproduct_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: providerproduct_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.providerproduct_id_seq OWNED BY public.providerproduct.id;


--
-- Name: purchase_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    order_number character varying NOT NULL,
    supplier_id integer,
    status public.purchaseorderstatus NOT NULL,
    order_date timestamp with time zone NOT NULL,
    expected_date date,
    received_date timestamp with time zone,
    subtotal_cents integer NOT NULL,
    tax_cents integer NOT NULL,
    total_cents integer NOT NULL,
    notes character varying,
    created_by_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: purchase_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_order_id_seq OWNED BY public.purchase_order.id;


--
-- Name: purchase_order_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_item (
    id integer NOT NULL,
    purchase_order_id integer NOT NULL,
    inventory_item_id integer NOT NULL,
    quantity_ordered numeric(12,4) NOT NULL,
    quantity_received numeric(12,4) NOT NULL,
    unit public.unitofmeasure NOT NULL,
    unit_cost_cents integer NOT NULL,
    line_total_cents integer NOT NULL
);


--
-- Name: purchase_order_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_order_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_order_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_order_item_id_seq OWNED BY public.purchase_order_item.id;


--
-- Name: reservation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    customer_name character varying NOT NULL,
    customer_phone character varying NOT NULL,
    customer_email character varying,
    reservation_date date NOT NULL,
    reservation_time time without time zone NOT NULL,
    party_size integer NOT NULL,
    status public.reservationstatus NOT NULL,
    table_id integer,
    seated_at timestamp with time zone,
    token character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    client_notes character varying,
    customer_notes character varying,
    owner_notes character varying,
    delay_notice character varying,
    client_ip character varying(45),
    client_user_agent character varying(512),
    client_fingerprint character varying(256),
    client_screen_width integer,
    client_screen_height integer,
    reminder_24h_sent_at timestamp with time zone,
    reminder_2h_sent_at timestamp with time zone,
    service_type character varying(16),
    seating_preference character varying(32),
    allergies_has boolean NOT NULL,
    allergies_detail character varying,
    preferred_floor_id integer,
    locale character varying(16),
    guest_birthday_month integer,
    guest_birthday_day integer,
    guest_birthday_marketing_consent boolean NOT NULL,
    CONSTRAINT ck_reservation_guest_birthday_day CHECK (((guest_birthday_day IS NULL) OR ((guest_birthday_day >= 1) AND (guest_birthday_day <= 31)))),
    CONSTRAINT ck_reservation_guest_birthday_month CHECK (((guest_birthday_month IS NULL) OR ((guest_birthday_month >= 1) AND (guest_birthday_month <= 12)))),
    CONSTRAINT ck_reservation_guest_birthday_pair CHECK ((((guest_birthday_month IS NULL) AND (guest_birthday_day IS NULL)) OR ((guest_birthday_month IS NOT NULL) AND (guest_birthday_day IS NOT NULL))))
);


--
-- Name: COLUMN reservation.preferred_floor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reservation.preferred_floor_id IS 'Public/staff: seating zone for capacity and display; null = venue-wide / legacy.';


--
-- Name: reservation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reservation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reservation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reservation_id_seq OWNED BY public.reservation.id;


--
-- Name: shift; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    user_id integer NOT NULL,
    shift_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    label character varying(64),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: shift_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shift_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shift_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shift_id_seq OWNED BY public.shift.id;


--
-- Name: staff_contract; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_contract (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    contract_group_id uuid NOT NULL,
    version integer NOT NULL,
    subject_user_id integer NOT NULL,
    kind public.staff_contract_kind NOT NULL,
    status public.staff_contract_status NOT NULL,
    role_title character varying(256) NOT NULL,
    start_date date,
    end_date date,
    compensation_summary text,
    tax_identifier_subject character varying(128),
    payment_structure public.staff_contract_payment_structure NOT NULL,
    payment_terms text,
    jurisdiction_note text,
    template_key character varying(64),
    notes_internal text,
    document_filename character varying(512),
    document_uploaded_at timestamp with time zone,
    created_by_user_id integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: staff_contract_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_contract_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_contract_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_contract_id_seq OWNED BY public.staff_contract.id;


--
-- Name: staff_contract_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_contract_template (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    template_key character varying(64) NOT NULL,
    name character varying(256) NOT NULL,
    body text NOT NULL,
    locale character varying(16),
    kind public.staff_contract_kind,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: staff_contract_template_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_contract_template_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_contract_template_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_contract_template_id_seq OWNED BY public.staff_contract_template.id;


--
-- Name: staff_contract_template_preset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_contract_template_preset (
    id integer NOT NULL,
    region_code character varying(8) NOT NULL,
    locale character varying(16) NOT NULL,
    template_key character varying(64) NOT NULL,
    name character varying(256) NOT NULL,
    body text NOT NULL,
    kind public.staff_contract_kind,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_contract_template_preset_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_contract_template_preset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_contract_template_preset_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_contract_template_preset_id_seq OWNED BY public.staff_contract_template_preset.id;


--
-- Name: supplier; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying NOT NULL,
    code character varying,
    contact_name character varying,
    phone character varying,
    email character varying,
    address character varying,
    payment_terms character varying,
    lead_time_days integer,
    minimum_order_cents integer,
    notes character varying,
    is_active boolean NOT NULL,
    is_deleted boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: supplier_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supplier_id_seq OWNED BY public.supplier.id;


--
-- Name: table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."table" (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying NOT NULL,
    token character varying NOT NULL,
    floor_id integer,
    x_position double precision NOT NULL,
    y_position double precision NOT NULL,
    rotation double precision NOT NULL,
    shape character varying NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    seat_count integer NOT NULL,
    table_group_id integer,
    assigned_waiter_id integer,
    is_active boolean NOT NULL,
    active_order_id integer,
    activated_at timestamp with time zone,
    order_code character varying(6)
);


--
-- Name: table_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_group (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: table_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_group_id_seq OWNED BY public.table_group.id;


--
-- Name: table_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_id_seq OWNED BY public."table".id;


--
-- Name: tax; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(128) NOT NULL,
    rate_percent integer NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: tax_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tax_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tax_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tax_id_seq OWNED BY public.tax.id;


--
-- Name: tenant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant (
    id integer NOT NULL,
    name character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    business_type public.businesstype,
    description character varying,
    phone character varying,
    whatsapp character varying,
    email character varying,
    address character varying,
    city character varying(120),
    public_slug character varying(160),
    website character varying,
    tax_id character varying,
    cif character varying,
    ccc character varying,
    logo_filename character varying,
    header_background_filename character varying,
    public_background_color character varying,
    public_primary_color character varying,
    opening_hours character varying,
    immediate_payment_required boolean NOT NULL,
    timezone character varying,
    country_code character varying(2),
    stripe_secret_key character varying,
    stripe_publishable_key character varying,
    revolut_merchant_secret character varying,
    payment_nequi_number character varying(40),
    payment_llave character varying(120),
    payment_account_holder character varying(120),
    payment_qr_filename character varying,
    latitude double precision,
    longitude double precision,
    location_radius_meters integer NOT NULL,
    location_check_enabled boolean NOT NULL,
    smtp_host character varying,
    smtp_port integer,
    smtp_use_tls boolean,
    smtp_user character varying,
    smtp_password character varying,
    email_from character varying,
    email_from_name character varying,
    reservation_confirmation_email_subject character varying,
    reservation_confirmation_email_body character varying,
    working_plan_updated_at timestamp with time zone,
    working_plan_owner_seen_at timestamp with time zone,
    reservation_prepayment_cents integer,
    reservation_prepayment_text character varying,
    reservation_cancellation_policy character varying,
    reservation_arrival_tolerance_minutes integer,
    reservation_average_table_turn_minutes integer,
    reservation_slot_minutes integer,
    reservation_max_guests_per_slot integer,
    reservation_walk_in_tables_reserved integer NOT NULL,
    reservation_dress_code character varying,
    reservation_reminder_24h_enabled boolean NOT NULL,
    reservation_reminder_2h_enabled boolean NOT NULL,
    guest_birthday_capture_enabled boolean NOT NULL,
    guest_birthday_marketing_enabled boolean NOT NULL,
    guest_birthday_consent_text character varying,
    delivery_fee_cents integer NOT NULL,
    delivery_radius_meters integer,
    delivery_postal_codes character varying,
    public_google_review_url character varying(2048),
    public_google_maps_url character varying(2048),
    public_openstreetmap_url character varying(2048),
    public_terms_of_service_url character varying(2048),
    public_privacy_policy_url character varying(2048),
    kitchen_display_timer_yellow_minutes integer,
    kitchen_display_timer_orange_minutes integer,
    kitchen_display_timer_red_minutes integer,
    tip_preset_percents jsonb,
    tip_tax_rate_percent integer,
    tip_entry_mode character varying(32) NOT NULL,
    default_tax_id integer,
    default_kitchen_station_id integer,
    default_bar_station_id integer,
    ui_modules jsonb,
    custom_subcategories jsonb,
    clock_qr_token_hash character varying(128),
    clock_qr_token_encrypted text,
    clock_qr_location_verify boolean NOT NULL,
    custom_category_labels jsonb,
    public_facebook_url character varying(2048) DEFAULT NULL::character varying,
    public_instagram_url character varying(2048) DEFAULT NULL::character varying,
    dian_mode character varying(16) DEFAULT 'off'::character varying NOT NULL,
    dian_invoice_next_number integer DEFAULT 1 NOT NULL,
    dian_tax_regime character varying(32),
    dian_client_id character varying(128),
    CONSTRAINT tenant_dian_mode_check CHECK (((dian_mode)::text = ANY ((ARRAY['off'::character varying, 'test'::character varying, 'live'::character varying])::text[])))
);


--
-- Name: COLUMN tenant.reservation_max_guests_per_slot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.reservation_max_guests_per_slot IS 'When set (>0), caps total guests per slot to min(physical pool, this value).';


--
-- Name: COLUMN tenant.delivery_fee_cents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.delivery_fee_cents IS 'Flat Satisfecho Delivery fee in cents (0 = free)';


--
-- Name: COLUMN tenant.delivery_radius_meters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.delivery_radius_meters IS 'Optional max delivery distance from tenant lat/lng; null = no radius check';


--
-- Name: COLUMN tenant.delivery_postal_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.delivery_postal_codes IS 'Optional JSON array of allowed postal codes; null/empty = no postal check';


--
-- Name: COLUMN tenant.kitchen_display_timer_yellow_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.kitchen_display_timer_yellow_minutes IS 'Minutes since order: card turns yellow after this';


--
-- Name: COLUMN tenant.kitchen_display_timer_orange_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.kitchen_display_timer_orange_minutes IS 'Minutes since order: card turns orange after this';


--
-- Name: COLUMN tenant.kitchen_display_timer_red_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.kitchen_display_timer_red_minutes IS 'Minutes since order: card turns red after this';


--
-- Name: COLUMN tenant.custom_subcategories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.custom_subcategories IS 'Tenant-scoped subcategory names by category, e.g. {"Starters":["House Special"]}';


--
-- Name: COLUMN tenant.custom_category_labels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant.custom_category_labels IS 'Tenant-scoped display label overrides for standard categories, e.g. {"Main Course":"Plato fuerte"}';


--
-- Name: tenant_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_id_seq OWNED BY public.tenant.id;


--
-- Name: tenantproduct; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenantproduct (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    catalog_id integer NOT NULL,
    provider_product_id integer,
    product_id integer,
    name character varying NOT NULL,
    price_cents integer NOT NULL,
    cost_cents integer,
    image_filename character varying,
    ingredients character varying,
    is_active boolean NOT NULL,
    tax_id integer,
    available_from date,
    available_until date,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: tenantproduct_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenantproduct_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenantproduct_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenantproduct_id_seq OWNED BY public.tenantproduct.id;


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id integer NOT NULL,
    username character varying CONSTRAINT user_email_not_null NOT NULL,
    hashed_password character varying NOT NULL,
    full_name character varying,
    token_version integer NOT NULL,
    role public.user_role NOT NULL,
    tenant_id integer,
    otp_secret character varying,
    otp_enabled boolean NOT NULL,
    employee_number character varying(64)
);


--
-- Name: user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_id_seq OWNED BY public."user".id;


--
-- Name: user_otp_recovery_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_otp_recovery_code (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code_hash character varying(64) NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: user_otp_recovery_code_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_otp_recovery_code_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_otp_recovery_code_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_otp_recovery_code_id_seq OWNED BY public.user_otp_recovery_code.id;


--
-- Name: waiting_list_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waiting_list_entry (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    customer_name character varying(200) NOT NULL,
    customer_phone character varying(40) NOT NULL,
    party_size integer NOT NULL,
    status public.waitingliststatus NOT NULL,
    notified_at timestamp with time zone,
    client_ip character varying(45),
    client_user_agent character varying(512),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: waiting_list_entry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.waiting_list_entry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: waiting_list_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.waiting_list_entry_id_seq OWNED BY public.waiting_list_entry.id;


--
-- Name: warehouse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    name character varying NOT NULL,
    code character varying,
    is_default boolean NOT NULL,
    is_active boolean NOT NULL,
    is_deleted boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: warehouse_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouse_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouse_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouse_id_seq OWNED BY public.warehouse.id;


--
-- Name: warehouse_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse_stock (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    warehouse_id integer NOT NULL,
    inventory_item_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: warehouse_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouse_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouse_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.warehouse_stock_id_seq OWNED BY public.warehouse_stock.id;


--
-- Name: work_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_session (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    user_id integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    start_ip character varying(45),
    end_ip character varying(45),
    break_started_at timestamp with time zone
);


--
-- Name: work_session_adjustment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_session_adjustment (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    work_session_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    actor_user_id integer,
    note character varying NOT NULL,
    previous_started_at timestamp with time zone,
    previous_ended_at timestamp with time zone,
    new_started_at timestamp with time zone,
    new_ended_at timestamp with time zone
);


--
-- Name: work_session_adjustment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_session_adjustment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_session_adjustment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_session_adjustment_id_seq OWNED BY public.work_session_adjustment.id;


--
-- Name: work_session_break; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_session_break (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    work_session_id integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: work_session_break_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_session_break_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_session_break_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_session_break_id_seq OWNED BY public.work_session_break.id;


--
-- Name: work_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_session_id_seq OWNED BY public.work_session.id;


--
-- Name: billing_customer id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_customer ALTER COLUMN id SET DEFAULT nextval('public.billing_customer_id_seq'::regclass);


--
-- Name: delivery_catalog_mapping id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_catalog_mapping ALTER COLUMN id SET DEFAULT nextval('public.delivery_catalog_mapping_id_seq'::regclass);


--
-- Name: delivery_integration_event_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_integration_event_log ALTER COLUMN id SET DEFAULT nextval('public.delivery_integration_event_log_id_seq'::regclass);


--
-- Name: delivery_marketplace_integration id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_marketplace_integration ALTER COLUMN id SET DEFAULT nextval('public.delivery_marketplace_integration_id_seq'::regclass);


--
-- Name: dian_invoice id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dian_invoice ALTER COLUMN id SET DEFAULT nextval('public.dian_invoice_id_seq'::regclass);


--
-- Name: floor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floor ALTER COLUMN id SET DEFAULT nextval('public.floor_id_seq'::regclass);


--
-- Name: guest_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_feedback ALTER COLUMN id SET DEFAULT nextval('public.guest_feedback_id_seq'::regclass);


--
-- Name: i18ntext id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18ntext ALTER COLUMN id SET DEFAULT nextval('public.i18ntext_id_seq'::regclass);


--
-- Name: inventory_batch id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch ALTER COLUMN id SET DEFAULT nextval('public.inventory_batch_id_seq'::regclass);


--
-- Name: inventory_item id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_item ALTER COLUMN id SET DEFAULT nextval('public.inventory_item_id_seq'::regclass);


--
-- Name: inventory_transaction id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction ALTER COLUMN id SET DEFAULT nextval('public.inventory_transaction_id_seq'::regclass);


--
-- Name: kitchen_station id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_station ALTER COLUMN id SET DEFAULT nextval('public.kitchen_station_id_seq'::regclass);


--
-- Name: offline_order_idempotency id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_order_idempotency ALTER COLUMN id SET DEFAULT nextval('public.offline_order_idempotency_id_seq'::regclass);


--
-- Name: opening_hours_baseline_schedule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_baseline_schedule ALTER COLUMN id SET DEFAULT nextval('public.opening_hours_baseline_schedule_id_seq'::regclass);


--
-- Name: opening_hours_date_override id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_date_override ALTER COLUMN id SET DEFAULT nextval('public.opening_hours_date_override_id_seq'::regclass);


--
-- Name: order id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order" ALTER COLUMN id SET DEFAULT nextval('public.order_id_seq'::regclass);


--
-- Name: order_payment id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment ALTER COLUMN id SET DEFAULT nextval('public.order_payment_id_seq'::regclass);


--
-- Name: order_payment_item id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment_item ALTER COLUMN id SET DEFAULT nextval('public.order_payment_item_id_seq'::regclass);


--
-- Name: orderitem id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orderitem ALTER COLUMN id SET DEFAULT nextval('public.orderitem_id_seq'::regclass);


--
-- Name: price_promotion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_promotion ALTER COLUMN id SET DEFAULT nextval('public.price_promotion_id_seq'::regclass);


--
-- Name: print_agent id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_agent ALTER COLUMN id SET DEFAULT nextval('public.print_agent_id_seq'::regclass);


--
-- Name: print_job id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job ALTER COLUMN id SET DEFAULT nextval('public.print_job_id_seq'::regclass);


--
-- Name: product id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product ALTER COLUMN id SET DEFAULT nextval('public.product_id_seq'::regclass);


--
-- Name: product_recipe id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_recipe ALTER COLUMN id SET DEFAULT nextval('public.product_recipe_id_seq'::regclass);


--
-- Name: productcatalog id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productcatalog ALTER COLUMN id SET DEFAULT nextval('public.productcatalog_id_seq'::regclass);


--
-- Name: provider id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider ALTER COLUMN id SET DEFAULT nextval('public.provider_id_seq'::regclass);


--
-- Name: providerproduct id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providerproduct ALTER COLUMN id SET DEFAULT nextval('public.providerproduct_id_seq'::regclass);


--
-- Name: purchase_order id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order ALTER COLUMN id SET DEFAULT nextval('public.purchase_order_id_seq'::regclass);


--
-- Name: purchase_order_item id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item ALTER COLUMN id SET DEFAULT nextval('public.purchase_order_item_id_seq'::regclass);


--
-- Name: reservation id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation ALTER COLUMN id SET DEFAULT nextval('public.reservation_id_seq'::regclass);


--
-- Name: shift id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift ALTER COLUMN id SET DEFAULT nextval('public.shift_id_seq'::regclass);


--
-- Name: staff_contract id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract ALTER COLUMN id SET DEFAULT nextval('public.staff_contract_id_seq'::regclass);


--
-- Name: staff_contract_template id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template ALTER COLUMN id SET DEFAULT nextval('public.staff_contract_template_id_seq'::regclass);


--
-- Name: staff_contract_template_preset id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template_preset ALTER COLUMN id SET DEFAULT nextval('public.staff_contract_template_preset_id_seq'::regclass);


--
-- Name: supplier id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier ALTER COLUMN id SET DEFAULT nextval('public.supplier_id_seq'::regclass);


--
-- Name: table id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table" ALTER COLUMN id SET DEFAULT nextval('public.table_id_seq'::regclass);


--
-- Name: table_group id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group ALTER COLUMN id SET DEFAULT nextval('public.table_group_id_seq'::regclass);


--
-- Name: tax id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax ALTER COLUMN id SET DEFAULT nextval('public.tax_id_seq'::regclass);


--
-- Name: tenant id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant ALTER COLUMN id SET DEFAULT nextval('public.tenant_id_seq'::regclass);


--
-- Name: tenantproduct id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct ALTER COLUMN id SET DEFAULT nextval('public.tenantproduct_id_seq'::regclass);


--
-- Name: user id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user" ALTER COLUMN id SET DEFAULT nextval('public.user_id_seq'::regclass);


--
-- Name: user_otp_recovery_code id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otp_recovery_code ALTER COLUMN id SET DEFAULT nextval('public.user_otp_recovery_code_id_seq'::regclass);


--
-- Name: waiting_list_entry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiting_list_entry ALTER COLUMN id SET DEFAULT nextval('public.waiting_list_entry_id_seq'::regclass);


--
-- Name: warehouse id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse ALTER COLUMN id SET DEFAULT nextval('public.warehouse_id_seq'::regclass);


--
-- Name: warehouse_stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_stock ALTER COLUMN id SET DEFAULT nextval('public.warehouse_stock_id_seq'::regclass);


--
-- Name: work_session id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session ALTER COLUMN id SET DEFAULT nextval('public.work_session_id_seq'::regclass);


--
-- Name: work_session_adjustment id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_adjustment ALTER COLUMN id SET DEFAULT nextval('public.work_session_adjustment_id_seq'::regclass);


--
-- Name: work_session_break id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_break ALTER COLUMN id SET DEFAULT nextval('public.work_session_break_id_seq'::regclass);


--
-- Name: billing_customer billing_customer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_customer
    ADD CONSTRAINT billing_customer_pkey PRIMARY KEY (id);


--
-- Name: delivery_catalog_mapping delivery_catalog_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_catalog_mapping
    ADD CONSTRAINT delivery_catalog_mapping_pkey PRIMARY KEY (id);


--
-- Name: delivery_integration_event_log delivery_integration_event_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_integration_event_log
    ADD CONSTRAINT delivery_integration_event_log_pkey PRIMARY KEY (id);


--
-- Name: delivery_marketplace_integration delivery_marketplace_integration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_marketplace_integration
    ADD CONSTRAINT delivery_marketplace_integration_pkey PRIMARY KEY (id);


--
-- Name: dian_invoice dian_invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dian_invoice
    ADD CONSTRAINT dian_invoice_pkey PRIMARY KEY (id);


--
-- Name: floor floor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floor
    ADD CONSTRAINT floor_pkey PRIMARY KEY (id);


--
-- Name: guest_feedback guest_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_feedback
    ADD CONSTRAINT guest_feedback_pkey PRIMARY KEY (id);


--
-- Name: i18ntext i18ntext_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18ntext
    ADD CONSTRAINT i18ntext_pkey PRIMARY KEY (id);


--
-- Name: inventory_batch inventory_batch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch
    ADD CONSTRAINT inventory_batch_pkey PRIMARY KEY (id);


--
-- Name: inventory_item inventory_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_item
    ADD CONSTRAINT inventory_item_pkey PRIMARY KEY (id);


--
-- Name: inventory_transaction inventory_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_pkey PRIMARY KEY (id);


--
-- Name: kitchen_station kitchen_station_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_station
    ADD CONSTRAINT kitchen_station_pkey PRIMARY KEY (id);


--
-- Name: offline_order_idempotency offline_order_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_order_idempotency
    ADD CONSTRAINT offline_order_idempotency_pkey PRIMARY KEY (id);


--
-- Name: opening_hours_baseline_schedule opening_hours_baseline_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_baseline_schedule
    ADD CONSTRAINT opening_hours_baseline_schedule_pkey PRIMARY KEY (id);


--
-- Name: opening_hours_date_override opening_hours_date_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_date_override
    ADD CONSTRAINT opening_hours_date_override_pkey PRIMARY KEY (id);


--
-- Name: order_payment_item order_payment_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment_item
    ADD CONSTRAINT order_payment_item_pkey PRIMARY KEY (id);


--
-- Name: order_payment order_payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment
    ADD CONSTRAINT order_payment_pkey PRIMARY KEY (id);


--
-- Name: order order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_pkey PRIMARY KEY (id);


--
-- Name: orderitem orderitem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orderitem
    ADD CONSTRAINT orderitem_pkey PRIMARY KEY (id);


--
-- Name: price_promotion price_promotion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_promotion
    ADD CONSTRAINT price_promotion_pkey PRIMARY KEY (id);


--
-- Name: print_agent print_agent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_agent
    ADD CONSTRAINT print_agent_pkey PRIMARY KEY (id);


--
-- Name: print_job print_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job
    ADD CONSTRAINT print_job_pkey PRIMARY KEY (id);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);


--
-- Name: product_recipe product_recipe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_recipe
    ADD CONSTRAINT product_recipe_pkey PRIMARY KEY (id);


--
-- Name: productcatalog productcatalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productcatalog
    ADD CONSTRAINT productcatalog_pkey PRIMARY KEY (id);


--
-- Name: provider provider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider
    ADD CONSTRAINT provider_pkey PRIMARY KEY (id);


--
-- Name: providerproduct providerproduct_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providerproduct
    ADD CONSTRAINT providerproduct_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_item purchase_order_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT purchase_order_item_pkey PRIMARY KEY (id);


--
-- Name: purchase_order purchase_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_pkey PRIMARY KEY (id);


--
-- Name: reservation reservation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_pkey PRIMARY KEY (id);


--
-- Name: shift shift_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift
    ADD CONSTRAINT shift_pkey PRIMARY KEY (id);


--
-- Name: staff_contract staff_contract_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract
    ADD CONSTRAINT staff_contract_pkey PRIMARY KEY (id);


--
-- Name: staff_contract_template staff_contract_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template
    ADD CONSTRAINT staff_contract_template_pkey PRIMARY KEY (id);


--
-- Name: staff_contract_template_preset staff_contract_template_preset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template_preset
    ADD CONSTRAINT staff_contract_template_preset_pkey PRIMARY KEY (id);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (id);


--
-- Name: table_group table_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group
    ADD CONSTRAINT table_group_pkey PRIMARY KEY (id);


--
-- Name: table table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT table_pkey PRIMARY KEY (id);


--
-- Name: tax tax_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax
    ADD CONSTRAINT tax_pkey PRIMARY KEY (id);


--
-- Name: tenant tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_pkey PRIMARY KEY (id);


--
-- Name: tenantproduct tenantproduct_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_pkey PRIMARY KEY (id);


--
-- Name: offline_order_idempotency uq_offline_order_idempotency_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_order_idempotency
    ADD CONSTRAINT uq_offline_order_idempotency_tenant_key UNIQUE (tenant_id, idempotency_key);


--
-- Name: print_agent uq_print_agent_tenant_device; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_agent
    ADD CONSTRAINT uq_print_agent_tenant_device UNIQUE (tenant_id, device_id);


--
-- Name: print_agent uq_print_agent_token_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_agent
    ADD CONSTRAINT uq_print_agent_token_hash UNIQUE (token_hash);


--
-- Name: staff_contract_template_preset uq_staff_contract_template_preset_region_locale_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template_preset
    ADD CONSTRAINT uq_staff_contract_template_preset_region_locale_key UNIQUE (region_code, locale, template_key);


--
-- Name: staff_contract_template uq_staff_contract_template_tenant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template
    ADD CONSTRAINT uq_staff_contract_template_tenant_key UNIQUE (tenant_id, template_key);


--
-- Name: user_otp_recovery_code user_otp_recovery_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otp_recovery_code
    ADD CONSTRAINT user_otp_recovery_code_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: waiting_list_entry waiting_list_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiting_list_entry
    ADD CONSTRAINT waiting_list_entry_pkey PRIMARY KEY (id);


--
-- Name: warehouse warehouse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_pkey PRIMARY KEY (id);


--
-- Name: warehouse_stock warehouse_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_pkey PRIMARY KEY (id);


--
-- Name: work_session_adjustment work_session_adjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_adjustment
    ADD CONSTRAINT work_session_adjustment_pkey PRIMARY KEY (id);


--
-- Name: work_session_break work_session_break_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_break
    ADD CONSTRAINT work_session_break_pkey PRIMARY KEY (id);


--
-- Name: work_session work_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session
    ADD CONSTRAINT work_session_pkey PRIMARY KEY (id);


--
-- Name: idx_billing_customer_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_customer_company_name ON public.billing_customer USING btree (company_name);


--
-- Name: idx_billing_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_customer_email ON public.billing_customer USING btree (email);


--
-- Name: idx_billing_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_customer_name ON public.billing_customer USING btree (name);


--
-- Name: idx_billing_customer_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_customer_tax_id ON public.billing_customer USING btree (tax_id);


--
-- Name: idx_billing_customer_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_customer_tenant ON public.billing_customer USING btree (tenant_id);


--
-- Name: idx_floor_default_waiter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_floor_default_waiter ON public.floor USING btree (default_waiter_id);


--
-- Name: idx_floor_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_floor_tenant ON public.floor USING btree (tenant_id);


--
-- Name: idx_order_billing_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_billing_customer ON public."order" USING btree (billing_customer_id);


--
-- Name: idx_order_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_customer_name ON public."order" USING btree (customer_name);


--
-- Name: idx_order_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_paid ON public."order" USING btree (paid_at, payment_method);


--
-- Name: idx_order_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_session ON public."order" USING btree (table_id, session_id);


--
-- Name: idx_order_tenant_staff_urgent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_tenant_staff_urgent ON public."order" USING btree (tenant_id, staff_urgent) WHERE (staff_urgent = true);


--
-- Name: idx_orderitem_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orderitem_active ON public.orderitem USING btree (order_id, removed_by_customer) WHERE (removed_by_customer = false);


--
-- Name: idx_orderitem_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orderitem_modified ON public.orderitem USING btree (order_id, modified_at);


--
-- Name: idx_orderitem_removed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orderitem_removed ON public.orderitem USING btree (order_id, removed_by_customer);


--
-- Name: idx_orderitem_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orderitem_status ON public.orderitem USING btree (order_id, status);


--
-- Name: idx_orderitem_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orderitem_tax_id ON public.orderitem USING btree (tax_id) WHERE (tax_id IS NOT NULL);


--
-- Name: idx_product_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_category ON public.product USING btree (category) WHERE (category IS NOT NULL);


--
-- Name: idx_product_subcategory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_subcategory ON public.product USING btree (subcategory) WHERE (subcategory IS NOT NULL);


--
-- Name: idx_product_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_tax_id ON public.product USING btree (tax_id) WHERE (tax_id IS NOT NULL);


--
-- Name: idx_productcatalog_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productcatalog_barcode ON public.productcatalog USING btree (barcode);


--
-- Name: idx_productcatalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productcatalog_category ON public.productcatalog USING btree (category);


--
-- Name: idx_productcatalog_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productcatalog_name ON public.productcatalog USING btree (name);


--
-- Name: idx_productcatalog_normalized_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productcatalog_normalized_name ON public.productcatalog USING btree (normalized_name);


--
-- Name: idx_productcatalog_subcategory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productcatalog_subcategory ON public.productcatalog USING btree (subcategory);


--
-- Name: idx_provider_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_is_active ON public.provider USING btree (is_active);


--
-- Name: idx_provider_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_name ON public.provider USING btree (name);


--
-- Name: idx_provider_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_tenant_id ON public.provider USING btree (tenant_id) WHERE (tenant_id IS NOT NULL);


--
-- Name: idx_provider_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_provider_tenant_name ON public.provider USING btree (COALESCE(tenant_id, '-1'::integer), name);


--
-- Name: idx_provider_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_provider_token ON public.provider USING btree (token) WHERE (token IS NOT NULL);


--
-- Name: idx_providerproduct_availability; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_availability ON public.providerproduct USING btree (availability);


--
-- Name: idx_providerproduct_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_catalog_id ON public.providerproduct USING btree (catalog_id);


--
-- Name: idx_providerproduct_catalog_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_catalog_provider ON public.providerproduct USING btree (catalog_id, provider_id, availability, price_cents);


--
-- Name: idx_providerproduct_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_external_id ON public.providerproduct USING btree (external_id);


--
-- Name: idx_providerproduct_image_filename; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_image_filename ON public.providerproduct USING btree (image_filename) WHERE (image_filename IS NOT NULL);


--
-- Name: idx_providerproduct_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_price ON public.providerproduct USING btree (price_cents) WHERE (price_cents IS NOT NULL);


--
-- Name: idx_providerproduct_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_provider_id ON public.providerproduct USING btree (provider_id);


--
-- Name: idx_providerproduct_vintage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_vintage ON public.providerproduct USING btree (vintage) WHERE (vintage IS NOT NULL);


--
-- Name: idx_providerproduct_wine_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_wine_category_id ON public.providerproduct USING btree (wine_category_id) WHERE (wine_category_id IS NOT NULL);


--
-- Name: idx_providerproduct_winery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_providerproduct_winery ON public.providerproduct USING btree (winery) WHERE (winery IS NOT NULL);


--
-- Name: idx_reservation_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservation_customer_email ON public.reservation USING btree (customer_email) WHERE (customer_email IS NOT NULL);


--
-- Name: idx_reservation_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservation_table ON public.reservation USING btree (table_id);


--
-- Name: idx_reservation_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservation_tenant ON public.reservation USING btree (tenant_id);


--
-- Name: idx_reservation_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservation_tenant_date ON public.reservation USING btree (tenant_id, reservation_date);


--
-- Name: idx_reservation_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservation_tenant_status ON public.reservation USING btree (tenant_id, status);


--
-- Name: idx_reservation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_reservation_token ON public.reservation USING btree (token) WHERE (token IS NOT NULL);


--
-- Name: idx_shift_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_tenant_date ON public.shift USING btree (tenant_id, shift_date);


--
-- Name: idx_shift_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_user_date ON public.shift USING btree (user_id, shift_date);


--
-- Name: idx_table_assigned_waiter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_assigned_waiter ON public."table" USING btree (assigned_waiter_id);


--
-- Name: idx_table_floor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_floor ON public."table" USING btree (floor_id);


--
-- Name: idx_table_group_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_group_tenant ON public.table_group USING btree (tenant_id);


--
-- Name: idx_table_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_is_active ON public."table" USING btree (is_active);


--
-- Name: idx_table_table_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_table_group ON public."table" USING btree (table_group_id);


--
-- Name: idx_tax_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_tenant_id ON public.tax USING btree (tenant_id);


--
-- Name: idx_tax_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_valid ON public.tax USING btree (tenant_id, valid_from, valid_to);


--
-- Name: idx_tenant_default_tax; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_default_tax ON public.tenant USING btree (default_tax_id);


--
-- Name: idx_tenantproduct_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_catalog_id ON public.tenantproduct USING btree (catalog_id);


--
-- Name: idx_tenantproduct_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_is_active ON public.tenantproduct USING btree (is_active);


--
-- Name: idx_tenantproduct_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_product_id ON public.tenantproduct USING btree (product_id);


--
-- Name: idx_tenantproduct_provider_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_provider_product_id ON public.tenantproduct USING btree (provider_product_id);


--
-- Name: idx_tenantproduct_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_tax_id ON public.tenantproduct USING btree (tax_id) WHERE (tax_id IS NOT NULL);


--
-- Name: idx_tenantproduct_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_tenant_active ON public.tenantproduct USING btree (tenant_id, is_active);


--
-- Name: idx_tenantproduct_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenantproduct_tenant_id ON public.tenantproduct USING btree (tenant_id);


--
-- Name: idx_user_otp_recovery_code_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_otp_recovery_code_user_id ON public.user_otp_recovery_code USING btree (user_id);


--
-- Name: idx_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_role ON public."user" USING btree (role);


--
-- Name: idx_user_tenant_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_tenant_role ON public."user" USING btree (tenant_id, role);


--
-- Name: idx_work_session_adj_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_session_adj_tenant ON public.work_session_adjustment USING btree (tenant_id, created_at);


--
-- Name: idx_work_session_break_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_session_break_session ON public.work_session_break USING btree (work_session_id);


--
-- Name: idx_work_session_break_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_session_break_tenant ON public.work_session_break USING btree (tenant_id, started_at);


--
-- Name: idx_work_session_tenant_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_session_tenant_started ON public.work_session USING btree (tenant_id, started_at);


--
-- Name: idx_work_session_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_session_user_started ON public.work_session USING btree (user_id, started_at);


--
-- Name: ix_billing_customer_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_billing_customer_company_name ON public.billing_customer USING btree (company_name);


--
-- Name: ix_billing_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_billing_customer_email ON public.billing_customer USING btree (email);


--
-- Name: ix_billing_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_billing_customer_name ON public.billing_customer USING btree (name);


--
-- Name: ix_billing_customer_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_billing_customer_tax_id ON public.billing_customer USING btree (tax_id);


--
-- Name: ix_billing_customer_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_billing_customer_tenant_id ON public.billing_customer USING btree (tenant_id);


--
-- Name: ix_delivery_catalog_mapping_integration_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_catalog_mapping_integration_id ON public.delivery_catalog_mapping USING btree (integration_id);


--
-- Name: ix_delivery_catalog_mapping_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_catalog_mapping_tenant ON public.delivery_catalog_mapping USING btree (tenant_id);


--
-- Name: ix_delivery_catalog_mapping_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_catalog_mapping_tenant_id ON public.delivery_catalog_mapping USING btree (tenant_id);


--
-- Name: ix_delivery_event_log_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_event_log_tenant_created ON public.delivery_integration_event_log USING btree (tenant_id, created_at DESC);


--
-- Name: ix_delivery_integration_event_log_integration_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_integration_event_log_integration_id ON public.delivery_integration_event_log USING btree (integration_id);


--
-- Name: ix_delivery_integration_event_log_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_integration_event_log_tenant_id ON public.delivery_integration_event_log USING btree (tenant_id);


--
-- Name: ix_delivery_integration_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_integration_tenant ON public.delivery_marketplace_integration USING btree (tenant_id);


--
-- Name: ix_delivery_marketplace_integration_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_marketplace_integration_provider_key ON public.delivery_marketplace_integration USING btree (provider_key);


--
-- Name: ix_delivery_marketplace_integration_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_delivery_marketplace_integration_tenant_id ON public.delivery_marketplace_integration USING btree (tenant_id);


--
-- Name: ix_delivery_marketplace_integration_webhook_ingest_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_delivery_marketplace_integration_webhook_ingest_token ON public.delivery_marketplace_integration USING btree (webhook_ingest_token);


--
-- Name: ix_dian_invoice_cufe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_dian_invoice_cufe ON public.dian_invoice USING btree (cufe);


--
-- Name: ix_dian_invoice_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_dian_invoice_order_id ON public.dian_invoice USING btree (order_id);


--
-- Name: ix_dian_invoice_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_dian_invoice_tenant_id ON public.dian_invoice USING btree (tenant_id);


--
-- Name: ix_floor_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_floor_is_active ON public.floor USING btree (is_active);


--
-- Name: ix_guest_feedback_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_guest_feedback_tenant_created ON public.guest_feedback USING btree (tenant_id, created_at DESC);


--
-- Name: ix_i18ntext_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_i18ntext_entity_id ON public.i18ntext USING btree (entity_id);


--
-- Name: ix_i18ntext_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_i18ntext_entity_type ON public.i18ntext USING btree (entity_type);


--
-- Name: ix_i18ntext_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_i18ntext_field ON public.i18ntext USING btree (field);


--
-- Name: ix_i18ntext_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_i18ntext_lang ON public.i18ntext USING btree (lang);


--
-- Name: ix_i18ntext_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_i18ntext_tenant_id ON public.i18ntext USING btree (tenant_id);


--
-- Name: ix_inventory_batch_inventory_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_batch_inventory_item_id ON public.inventory_batch USING btree (inventory_item_id);


--
-- Name: ix_inventory_batch_purchase_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_batch_purchase_order_id ON public.inventory_batch USING btree (purchase_order_id);


--
-- Name: ix_inventory_batch_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_batch_warehouse_id ON public.inventory_batch USING btree (warehouse_id);


--
-- Name: ix_inventory_item_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_category ON public.inventory_item USING btree (category);


--
-- Name: ix_inventory_item_default_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_default_supplier_id ON public.inventory_item USING btree (default_supplier_id);


--
-- Name: ix_inventory_item_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_is_active ON public.inventory_item USING btree (is_active);


--
-- Name: ix_inventory_item_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_is_deleted ON public.inventory_item USING btree (is_deleted);


--
-- Name: ix_inventory_item_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_name ON public.inventory_item USING btree (name);


--
-- Name: ix_inventory_item_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_item_sku ON public.inventory_item USING btree (sku);


--
-- Name: ix_inventory_transaction_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_batch_id ON public.inventory_transaction USING btree (batch_id);


--
-- Name: ix_inventory_transaction_inventory_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_inventory_item_id ON public.inventory_transaction USING btree (inventory_item_id);


--
-- Name: ix_inventory_transaction_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_order_id ON public.inventory_transaction USING btree (order_id);


--
-- Name: ix_inventory_transaction_purchase_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_purchase_order_id ON public.inventory_transaction USING btree (purchase_order_id);


--
-- Name: ix_inventory_transaction_transaction_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_transaction_type ON public.inventory_transaction USING btree (transaction_type);


--
-- Name: ix_inventory_transaction_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inventory_transaction_warehouse_id ON public.inventory_transaction USING btree (warehouse_id);


--
-- Name: ix_kitchen_station_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_kitchen_station_tenant_id ON public.kitchen_station USING btree (tenant_id);


--
-- Name: ix_kitchen_station_tenant_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_kitchen_station_tenant_route ON public.kitchen_station USING btree (tenant_id, display_route);


--
-- Name: ix_offline_order_idempotency_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_offline_order_idempotency_idempotency_key ON public.offline_order_idempotency USING btree (idempotency_key);


--
-- Name: ix_offline_order_idempotency_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_offline_order_idempotency_order_id ON public.offline_order_idempotency USING btree (order_id);


--
-- Name: ix_offline_order_idempotency_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_offline_order_idempotency_tenant_id ON public.offline_order_idempotency USING btree (tenant_id);


--
-- Name: ix_ohbs_tenant_eff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ohbs_tenant_eff ON public.opening_hours_baseline_schedule USING btree (tenant_id, effective_from DESC);


--
-- Name: ix_ohdo_tenant_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ohdo_tenant_range ON public.opening_hours_date_override USING btree (tenant_id, date_from, date_to);


--
-- Name: ix_opening_hours_baseline_schedule_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_opening_hours_baseline_schedule_tenant_id ON public.opening_hours_baseline_schedule USING btree (tenant_id);


--
-- Name: ix_opening_hours_date_override_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_opening_hours_date_override_tenant_id ON public.opening_hours_date_override USING btree (tenant_id);


--
-- Name: ix_order_billing_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_billing_customer_id ON public."order" USING btree (billing_customer_id);


--
-- Name: ix_order_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_channel ON public."order" USING btree (tenant_id, order_channel) WHERE (deleted_at IS NULL);


--
-- Name: ix_order_courier_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_courier_user ON public."order" USING btree (courier_user_id) WHERE (courier_user_id IS NOT NULL);


--
-- Name: ix_order_courier_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_courier_user_id ON public."order" USING btree (courier_user_id);


--
-- Name: ix_order_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_customer_name ON public."order" USING btree (customer_name);


--
-- Name: ix_order_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_deleted_at ON public."order" USING btree (deleted_at);


--
-- Name: ix_order_delivery_integration; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_delivery_integration ON public."order" USING btree (delivery_integration_id) WHERE (delivery_integration_id IS NOT NULL);


--
-- Name: ix_order_delivery_integration_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_delivery_integration_id ON public."order" USING btree (delivery_integration_id);


--
-- Name: ix_order_external_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_external_order_ref ON public."order" USING btree (external_order_ref);


--
-- Name: ix_order_order_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_order_channel ON public."order" USING btree (order_channel);


--
-- Name: ix_order_payment_item_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_item_order_item ON public.order_payment_item USING btree (order_item_id);


--
-- Name: ix_order_payment_item_order_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_item_order_item_id ON public.order_payment_item USING btree (order_item_id);


--
-- Name: ix_order_payment_item_order_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_item_order_payment_id ON public.order_payment_item USING btree (order_payment_id);


--
-- Name: ix_order_payment_item_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_item_payment ON public.order_payment_item USING btree (order_payment_id);


--
-- Name: ix_order_payment_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_order ON public.order_payment USING btree (order_id);


--
-- Name: ix_order_payment_order_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_order_active ON public.order_payment USING btree (order_id) WHERE (voided_at IS NULL);


--
-- Name: ix_order_payment_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_order_id ON public.order_payment USING btree (order_id);


--
-- Name: ix_order_payment_tenant_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_payment_tenant_paid ON public.order_payment USING btree (tenant_id, paid_at DESC);


--
-- Name: ix_order_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_session_id ON public."order" USING btree (session_id);


--
-- Name: ix_order_staff_urgent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_staff_urgent ON public."order" USING btree (staff_urgent);


--
-- Name: ix_order_tip_attributed_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_tip_attributed_user_id ON public."order" USING btree (tip_attributed_user_id);


--
-- Name: ix_orderitem_promo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orderitem_promo ON public.orderitem USING btree (promo_id);


--
-- Name: ix_orderitem_promo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orderitem_promo_id ON public.orderitem USING btree (promo_id);


--
-- Name: ix_orderitem_removed_by_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orderitem_removed_by_customer ON public.orderitem USING btree (removed_by_customer);


--
-- Name: ix_orderitem_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orderitem_status ON public.orderitem USING btree (status);


--
-- Name: ix_orderitem_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orderitem_tax_id ON public.orderitem USING btree (tax_id);


--
-- Name: ix_price_promotion_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_price_promotion_tenant ON public.price_promotion USING btree (tenant_id);


--
-- Name: ix_price_promotion_tenant_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_price_promotion_tenant_enabled ON public.price_promotion USING btree (tenant_id, enabled);


--
-- Name: ix_print_agent_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_agent_tenant ON public.print_agent USING btree (tenant_id);


--
-- Name: ix_print_agent_tenant_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_agent_tenant_last_seen ON public.print_agent USING btree (tenant_id, last_seen_at DESC);


--
-- Name: ix_print_agent_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_agent_token_hash ON public.print_agent USING btree (token_hash);


--
-- Name: ix_print_job_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_job_order_id ON public.print_job USING btree (order_id);


--
-- Name: ix_print_job_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_job_pending ON public.print_job USING btree (tenant_id, status, created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: ix_print_job_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_job_tenant_created ON public.print_job USING btree (tenant_id, created_at DESC);


--
-- Name: ix_print_job_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_print_job_tenant_status ON public.print_job USING btree (tenant_id, status);


--
-- Name: ix_product_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_category ON public.product USING btree (category);


--
-- Name: ix_product_kitchen_station_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_kitchen_station_id ON public.product USING btree (kitchen_station_id);


--
-- Name: ix_product_recipe_inventory_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_recipe_inventory_item_id ON public.product_recipe USING btree (inventory_item_id);


--
-- Name: ix_product_recipe_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_recipe_product_id ON public.product_recipe USING btree (product_id);


--
-- Name: ix_product_subcategory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_subcategory ON public.product USING btree (subcategory);


--
-- Name: ix_product_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_tax_id ON public.product USING btree (tax_id);


--
-- Name: ix_productcatalog_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_productcatalog_barcode ON public.productcatalog USING btree (barcode);


--
-- Name: ix_productcatalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_productcatalog_category ON public.productcatalog USING btree (category);


--
-- Name: ix_productcatalog_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_productcatalog_name ON public.productcatalog USING btree (name);


--
-- Name: ix_productcatalog_normalized_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_productcatalog_normalized_name ON public.productcatalog USING btree (normalized_name);


--
-- Name: ix_productcatalog_subcategory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_productcatalog_subcategory ON public.productcatalog USING btree (subcategory);


--
-- Name: ix_provider_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_provider_is_active ON public.provider USING btree (is_active);


--
-- Name: ix_provider_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_provider_name ON public.provider USING btree (name);


--
-- Name: ix_provider_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_provider_tenant_id ON public.provider USING btree (tenant_id);


--
-- Name: ix_provider_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_provider_token ON public.provider USING btree (token);


--
-- Name: ix_providerproduct_availability; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_providerproduct_availability ON public.providerproduct USING btree (availability);


--
-- Name: ix_providerproduct_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_providerproduct_catalog_id ON public.providerproduct USING btree (catalog_id);


--
-- Name: ix_providerproduct_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_providerproduct_external_id ON public.providerproduct USING btree (external_id);


--
-- Name: ix_providerproduct_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_providerproduct_provider_id ON public.providerproduct USING btree (provider_id);


--
-- Name: ix_purchase_order_item_inventory_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_purchase_order_item_inventory_item_id ON public.purchase_order_item USING btree (inventory_item_id);


--
-- Name: ix_purchase_order_item_purchase_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_purchase_order_item_purchase_order_id ON public.purchase_order_item USING btree (purchase_order_id);


--
-- Name: ix_purchase_order_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_purchase_order_order_number ON public.purchase_order USING btree (order_number);


--
-- Name: ix_purchase_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_purchase_order_status ON public.purchase_order USING btree (status);


--
-- Name: ix_purchase_order_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_purchase_order_supplier_id ON public.purchase_order USING btree (supplier_id);


--
-- Name: ix_reservation_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reservation_customer_email ON public.reservation USING btree (customer_email);


--
-- Name: ix_reservation_preferred_floor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reservation_preferred_floor_id ON public.reservation USING btree (preferred_floor_id);


--
-- Name: ix_reservation_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reservation_status ON public.reservation USING btree (status);


--
-- Name: ix_reservation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_reservation_token ON public.reservation USING btree (token);


--
-- Name: ix_staff_contract_contract_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_contract_group_id ON public.staff_contract USING btree (contract_group_id);


--
-- Name: ix_staff_contract_subject_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_subject_user_id ON public.staff_contract USING btree (subject_user_id);


--
-- Name: ix_staff_contract_template_preset_locale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_template_preset_locale ON public.staff_contract_template_preset USING btree (locale);


--
-- Name: ix_staff_contract_template_preset_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_template_preset_region ON public.staff_contract_template_preset USING btree (region_code);


--
-- Name: ix_staff_contract_template_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_template_tenant_id ON public.staff_contract_template USING btree (tenant_id);


--
-- Name: ix_staff_contract_tenant_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_tenant_group ON public.staff_contract USING btree (tenant_id, contract_group_id);


--
-- Name: ix_staff_contract_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_staff_contract_tenant_id ON public.staff_contract USING btree (tenant_id);


--
-- Name: ix_supplier_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_supplier_code ON public.supplier USING btree (code);


--
-- Name: ix_supplier_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_supplier_is_active ON public.supplier USING btree (is_active);


--
-- Name: ix_supplier_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_supplier_is_deleted ON public.supplier USING btree (is_deleted);


--
-- Name: ix_supplier_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_supplier_name ON public.supplier USING btree (name);


--
-- Name: ix_table_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_table_is_active ON public."table" USING btree (is_active);


--
-- Name: ix_table_table_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_table_table_group_id ON public."table" USING btree (table_group_id);


--
-- Name: ix_table_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_table_token ON public."table" USING btree (token);


--
-- Name: ix_tax_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tax_tenant_id ON public.tax USING btree (tenant_id);


--
-- Name: ix_tenant_default_bar_station_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_default_bar_station_id ON public.tenant USING btree (default_bar_station_id);


--
-- Name: ix_tenant_default_kitchen_station_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_default_kitchen_station_id ON public.tenant USING btree (default_kitchen_station_id);


--
-- Name: ix_tenant_default_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_default_tax_id ON public.tenant USING btree (default_tax_id);


--
-- Name: ix_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_name ON public.tenant USING btree (name);


--
-- Name: ix_tenant_public_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_public_slug ON public.tenant USING btree (public_slug);


--
-- Name: ix_tenantproduct_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_catalog_id ON public.tenantproduct USING btree (catalog_id);


--
-- Name: ix_tenantproduct_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_is_active ON public.tenantproduct USING btree (is_active);


--
-- Name: ix_tenantproduct_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_product_id ON public.tenantproduct USING btree (product_id);


--
-- Name: ix_tenantproduct_provider_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_provider_product_id ON public.tenantproduct USING btree (provider_product_id);


--
-- Name: ix_tenantproduct_tax_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_tax_id ON public.tenantproduct USING btree (tax_id);


--
-- Name: ix_tenantproduct_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenantproduct_tenant_id ON public.tenantproduct USING btree (tenant_id);


--
-- Name: ix_user_otp_recovery_code_code_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_otp_recovery_code_code_hash ON public.user_otp_recovery_code USING btree (code_hash);


--
-- Name: ix_user_otp_recovery_code_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_otp_recovery_code_user_id ON public.user_otp_recovery_code USING btree (user_id);


--
-- Name: ix_user_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_user_username ON public."user" USING btree (username);


--
-- Name: ix_waiting_list_entry_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_waiting_list_entry_status ON public.waiting_list_entry USING btree (status);


--
-- Name: ix_waiting_list_entry_tenant_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_waiting_list_entry_tenant_status_created ON public.waiting_list_entry USING btree (tenant_id, status, created_at);


--
-- Name: ix_warehouse_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_code ON public.warehouse USING btree (code);


--
-- Name: ix_warehouse_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_is_active ON public.warehouse USING btree (is_active);


--
-- Name: ix_warehouse_is_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_is_default ON public.warehouse USING btree (is_default);


--
-- Name: ix_warehouse_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_is_deleted ON public.warehouse USING btree (is_deleted);


--
-- Name: ix_warehouse_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_name ON public.warehouse USING btree (name);


--
-- Name: ix_warehouse_stock_inventory_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_stock_inventory_item_id ON public.warehouse_stock USING btree (inventory_item_id);


--
-- Name: ix_warehouse_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_stock_item ON public.warehouse_stock USING btree (inventory_item_id);


--
-- Name: ix_warehouse_stock_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_stock_tenant_id ON public.warehouse_stock USING btree (tenant_id);


--
-- Name: ix_warehouse_stock_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_stock_warehouse ON public.warehouse_stock USING btree (warehouse_id);


--
-- Name: ix_warehouse_stock_warehouse_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_stock_warehouse_id ON public.warehouse_stock USING btree (warehouse_id);


--
-- Name: ix_warehouse_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_tenant_active ON public.warehouse USING btree (tenant_id, is_active) WHERE (is_deleted = false);


--
-- Name: ix_warehouse_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_warehouse_tenant_id ON public.warehouse USING btree (tenant_id);


--
-- Name: ix_work_session_adjustment_actor_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_session_adjustment_actor_user_id ON public.work_session_adjustment USING btree (actor_user_id);


--
-- Name: ix_work_session_adjustment_work_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_session_adjustment_work_session_id ON public.work_session_adjustment USING btree (work_session_id);


--
-- Name: ix_work_session_break_work_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_session_break_work_session_id ON public.work_session_break USING btree (work_session_id);


--
-- Name: ix_work_session_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_work_session_user_id ON public.work_session USING btree (user_id);


--
-- Name: uq_dian_invoice_tenant_order_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dian_invoice_tenant_order_invoice ON public.dian_invoice USING btree (tenant_id, order_id) WHERE (((document_type)::text = 'invoice'::text) AND ((status)::text <> 'cancelled'::text));


--
-- Name: uq_order_delivery_external; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_order_delivery_external ON public."order" USING btree (delivery_integration_id, external_order_ref) WHERE ((delivery_integration_id IS NOT NULL) AND (external_order_ref IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: uq_order_payment_item_active_line; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_order_payment_item_active_line ON public.order_payment_item USING btree (order_item_id);


--
-- Name: uq_staff_contract_group_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_staff_contract_group_version ON public.staff_contract USING btree (contract_group_id, version);


--
-- Name: uq_user_otp_recovery_code_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_otp_recovery_code_hash ON public.user_otp_recovery_code USING btree (code_hash);


--
-- Name: uq_work_session_user_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_work_session_user_open ON public.work_session USING btree (user_id) WHERE (ended_at IS NULL);


--
-- Name: billing_customer billing_customer_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_customer
    ADD CONSTRAINT billing_customer_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: delivery_catalog_mapping delivery_catalog_mapping_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_catalog_mapping
    ADD CONSTRAINT delivery_catalog_mapping_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.delivery_marketplace_integration(id);


--
-- Name: delivery_catalog_mapping delivery_catalog_mapping_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_catalog_mapping
    ADD CONSTRAINT delivery_catalog_mapping_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id);


--
-- Name: delivery_catalog_mapping delivery_catalog_mapping_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_catalog_mapping
    ADD CONSTRAINT delivery_catalog_mapping_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: delivery_integration_event_log delivery_integration_event_log_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_integration_event_log
    ADD CONSTRAINT delivery_integration_event_log_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.delivery_marketplace_integration(id);


--
-- Name: delivery_integration_event_log delivery_integration_event_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_integration_event_log
    ADD CONSTRAINT delivery_integration_event_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: delivery_marketplace_integration delivery_marketplace_integration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_marketplace_integration
    ADD CONSTRAINT delivery_marketplace_integration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: dian_invoice dian_invoice_cancels_dian_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dian_invoice
    ADD CONSTRAINT dian_invoice_cancels_dian_invoice_id_fkey FOREIGN KEY (cancels_dian_invoice_id) REFERENCES public.dian_invoice(id);


--
-- Name: dian_invoice dian_invoice_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dian_invoice
    ADD CONSTRAINT dian_invoice_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: dian_invoice dian_invoice_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dian_invoice
    ADD CONSTRAINT dian_invoice_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: table fk_table_active_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT fk_table_active_order FOREIGN KEY (active_order_id) REFERENCES public."order"(id) ON DELETE SET NULL;


--
-- Name: floor floor_default_waiter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floor
    ADD CONSTRAINT floor_default_waiter_id_fkey FOREIGN KEY (default_waiter_id) REFERENCES public."user"(id);


--
-- Name: floor floor_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.floor
    ADD CONSTRAINT floor_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: guest_feedback guest_feedback_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_feedback
    ADD CONSTRAINT guest_feedback_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservation(id);


--
-- Name: guest_feedback guest_feedback_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_feedback
    ADD CONSTRAINT guest_feedback_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: i18ntext i18ntext_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.i18ntext
    ADD CONSTRAINT i18ntext_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: inventory_batch inventory_batch_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch
    ADD CONSTRAINT inventory_batch_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_item(id);


--
-- Name: inventory_batch inventory_batch_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch
    ADD CONSTRAINT inventory_batch_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_order(id);


--
-- Name: inventory_batch inventory_batch_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch
    ADD CONSTRAINT inventory_batch_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: inventory_batch inventory_batch_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch
    ADD CONSTRAINT inventory_batch_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: inventory_item inventory_item_default_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_item
    ADD CONSTRAINT inventory_item_default_supplier_id_fkey FOREIGN KEY (default_supplier_id) REFERENCES public.supplier(id);


--
-- Name: inventory_item inventory_item_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_item
    ADD CONSTRAINT inventory_item_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: inventory_transaction inventory_transaction_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batch(id);


--
-- Name: inventory_transaction inventory_transaction_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public."user"(id);


--
-- Name: inventory_transaction inventory_transaction_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_item(id);


--
-- Name: inventory_transaction inventory_transaction_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: inventory_transaction inventory_transaction_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_order(id);


--
-- Name: inventory_transaction inventory_transaction_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: inventory_transaction inventory_transaction_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: kitchen_station kitchen_station_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_station
    ADD CONSTRAINT kitchen_station_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: offline_order_idempotency offline_order_idempotency_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_order_idempotency
    ADD CONSTRAINT offline_order_idempotency_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: offline_order_idempotency offline_order_idempotency_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_order_idempotency
    ADD CONSTRAINT offline_order_idempotency_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: opening_hours_baseline_schedule opening_hours_baseline_schedule_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_baseline_schedule
    ADD CONSTRAINT opening_hours_baseline_schedule_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: opening_hours_date_override opening_hours_date_override_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_hours_date_override
    ADD CONSTRAINT opening_hours_date_override_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: order order_billing_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_billing_customer_id_fkey FOREIGN KEY (billing_customer_id) REFERENCES public.billing_customer(id);


--
-- Name: order order_courier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_courier_user_id_fkey FOREIGN KEY (courier_user_id) REFERENCES public."user"(id);


--
-- Name: order order_deleted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES public."user"(id);


--
-- Name: order order_delivery_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_delivery_integration_id_fkey FOREIGN KEY (delivery_integration_id) REFERENCES public.delivery_marketplace_integration(id);


--
-- Name: order_payment_item order_payment_item_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment_item
    ADD CONSTRAINT order_payment_item_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.orderitem(id);


--
-- Name: order_payment_item order_payment_item_order_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment_item
    ADD CONSTRAINT order_payment_item_order_payment_id_fkey FOREIGN KEY (order_payment_id) REFERENCES public.order_payment(id);


--
-- Name: order_payment_item order_payment_item_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment_item
    ADD CONSTRAINT order_payment_item_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: order_payment order_payment_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment
    ADD CONSTRAINT order_payment_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: order_payment order_payment_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment
    ADD CONSTRAINT order_payment_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES public."user"(id);


--
-- Name: order_payment order_payment_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payment
    ADD CONSTRAINT order_payment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: order order_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_table_id_fkey FOREIGN KEY (table_id) REFERENCES public."table"(id);


--
-- Name: order order_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: order order_tip_attributed_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_tip_attributed_user_id_fkey FOREIGN KEY (tip_attributed_user_id) REFERENCES public."user"(id);


--
-- Name: orderitem orderitem_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orderitem
    ADD CONSTRAINT orderitem_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: orderitem orderitem_promo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orderitem
    ADD CONSTRAINT orderitem_promo_id_fkey FOREIGN KEY (promo_id) REFERENCES public.price_promotion(id);


--
-- Name: orderitem orderitem_tax_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orderitem
    ADD CONSTRAINT orderitem_tax_id_fkey FOREIGN KEY (tax_id) REFERENCES public.tax(id);


--
-- Name: price_promotion price_promotion_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_promotion
    ADD CONSTRAINT price_promotion_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: print_agent print_agent_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_agent
    ADD CONSTRAINT print_agent_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: print_job print_job_claimed_by_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job
    ADD CONSTRAINT print_job_claimed_by_agent_id_fkey FOREIGN KEY (claimed_by_agent_id) REFERENCES public.print_agent(id);


--
-- Name: print_job print_job_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job
    ADD CONSTRAINT print_job_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id);


--
-- Name: print_job print_job_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job
    ADD CONSTRAINT print_job_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(id);


--
-- Name: print_job print_job_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_job
    ADD CONSTRAINT print_job_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: product product_kitchen_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_kitchen_station_id_fkey FOREIGN KEY (kitchen_station_id) REFERENCES public.kitchen_station(id);


--
-- Name: product_recipe product_recipe_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_recipe
    ADD CONSTRAINT product_recipe_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_item(id);


--
-- Name: product_recipe product_recipe_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_recipe
    ADD CONSTRAINT product_recipe_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id);


--
-- Name: product_recipe product_recipe_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_recipe
    ADD CONSTRAINT product_recipe_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: product product_tax_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_tax_id_fkey FOREIGN KEY (tax_id) REFERENCES public.tax(id);


--
-- Name: product product_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: provider provider_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider
    ADD CONSTRAINT provider_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: providerproduct providerproduct_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providerproduct
    ADD CONSTRAINT providerproduct_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES public.productcatalog(id);


--
-- Name: providerproduct providerproduct_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providerproduct
    ADD CONSTRAINT providerproduct_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.provider(id);


--
-- Name: purchase_order purchase_order_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public."user"(id);


--
-- Name: purchase_order_item purchase_order_item_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT purchase_order_item_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_item(id);


--
-- Name: purchase_order_item purchase_order_item_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT purchase_order_item_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_order(id);


--
-- Name: purchase_order purchase_order_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(id);


--
-- Name: purchase_order purchase_order_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: reservation reservation_preferred_floor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_preferred_floor_id_fkey FOREIGN KEY (preferred_floor_id) REFERENCES public.floor(id);


--
-- Name: reservation reservation_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_table_id_fkey FOREIGN KEY (table_id) REFERENCES public."table"(id);


--
-- Name: reservation reservation_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation
    ADD CONSTRAINT reservation_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: shift shift_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift
    ADD CONSTRAINT shift_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: shift shift_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift
    ADD CONSTRAINT shift_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: staff_contract staff_contract_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract
    ADD CONSTRAINT staff_contract_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id);


--
-- Name: staff_contract staff_contract_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract
    ADD CONSTRAINT staff_contract_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public."user"(id);


--
-- Name: staff_contract_template staff_contract_template_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract_template
    ADD CONSTRAINT staff_contract_template_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: staff_contract staff_contract_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_contract
    ADD CONSTRAINT staff_contract_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: supplier supplier_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: table table_assigned_waiter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT table_assigned_waiter_id_fkey FOREIGN KEY (assigned_waiter_id) REFERENCES public."user"(id);


--
-- Name: table table_floor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT table_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES public.floor(id);


--
-- Name: table_group table_group_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group
    ADD CONSTRAINT table_group_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: table table_table_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT table_table_group_id_fkey FOREIGN KEY (table_group_id) REFERENCES public.table_group(id);


--
-- Name: table table_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."table"
    ADD CONSTRAINT table_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: tax tax_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax
    ADD CONSTRAINT tax_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: tenant tenant_default_bar_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_default_bar_station_id_fkey FOREIGN KEY (default_bar_station_id) REFERENCES public.kitchen_station(id);


--
-- Name: tenant tenant_default_kitchen_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_default_kitchen_station_id_fkey FOREIGN KEY (default_kitchen_station_id) REFERENCES public.kitchen_station(id);


--
-- Name: tenant tenant_default_tax_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_default_tax_id_fkey FOREIGN KEY (default_tax_id) REFERENCES public.tax(id);


--
-- Name: tenantproduct tenantproduct_catalog_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES public.productcatalog(id);


--
-- Name: tenantproduct tenantproduct_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id);


--
-- Name: tenantproduct tenantproduct_provider_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_provider_product_id_fkey FOREIGN KEY (provider_product_id) REFERENCES public.providerproduct(id);


--
-- Name: tenantproduct tenantproduct_tax_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_tax_id_fkey FOREIGN KEY (tax_id) REFERENCES public.tax(id);


--
-- Name: tenantproduct tenantproduct_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenantproduct
    ADD CONSTRAINT tenantproduct_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: user_otp_recovery_code user_otp_recovery_code_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otp_recovery_code
    ADD CONSTRAINT user_otp_recovery_code_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: user user_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: waiting_list_entry waiting_list_entry_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waiting_list_entry
    ADD CONSTRAINT waiting_list_entry_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: warehouse_stock warehouse_stock_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_item(id);


--
-- Name: warehouse_stock warehouse_stock_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: warehouse_stock warehouse_stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: warehouse warehouse_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: work_session_adjustment work_session_adjustment_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_adjustment
    ADD CONSTRAINT work_session_adjustment_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public."user"(id);


--
-- Name: work_session_adjustment work_session_adjustment_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_adjustment
    ADD CONSTRAINT work_session_adjustment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: work_session_adjustment work_session_adjustment_work_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_adjustment
    ADD CONSTRAINT work_session_adjustment_work_session_id_fkey FOREIGN KEY (work_session_id) REFERENCES public.work_session(id);


--
-- Name: work_session_break work_session_break_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_break
    ADD CONSTRAINT work_session_break_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: work_session_break work_session_break_work_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session_break
    ADD CONSTRAINT work_session_break_work_session_id_fkey FOREIGN KEY (work_session_id) REFERENCES public.work_session(id);


--
-- Name: work_session work_session_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session
    ADD CONSTRAINT work_session_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id);


--
-- Name: work_session work_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_session
    ADD CONSTRAINT work_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- PostgreSQL database dump complete
--


