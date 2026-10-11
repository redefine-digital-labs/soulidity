CREATE UNIQUE INDEX "purchase_intents_payment_request_id_key"
ON "purchase_intents"("payment_request_id");

CREATE UNIQUE INDEX "orders_payment_request_id_key"
ON "orders"("payment_request_id");
