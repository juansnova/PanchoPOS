-- DIAN identification document type of a billing customer (CC, NIT, CE, PA, TI, RC).
ALTER TABLE public.billing_customer
    ADD COLUMN IF NOT EXISTS document_type varchar(8);
