from typing import Generator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings


settings = get_settings()
engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    apply_sqlite_poc_migrations()


def apply_sqlite_poc_migrations() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    migrations = {
        "person": [
            ("legacy_code", "VARCHAR NOT NULL DEFAULT ''"),
        ],
        "property": [
            ("legacy_code", "VARCHAR NOT NULL DEFAULT ''"),
            ("occupancy_status", "VARCHAR NOT NULL DEFAULT 'alquilada'"),
            ("property_type", "VARCHAR NOT NULL DEFAULT ''"),
            ("destination", "VARCHAR NOT NULL DEFAULT ''"),
        ],
        "contract": [
            ("legacy_code", "VARCHAR NOT NULL DEFAULT ''"),
            ("rent_payment_timing", "VARCHAR NOT NULL DEFAULT 'adelantado'"),
            ("guarantee_type", "VARCHAR NOT NULL DEFAULT 'sin_garantia'"),
            ("guarantee_provider", "VARCHAR NOT NULL DEFAULT ''"),
            ("guarantee_percent", "FLOAT NOT NULL DEFAULT 0"),
            ("rent_regime", "VARCHAR NOT NULL DEFAULT 'libre_contratacion'"),
            ("reajustment_index", "VARCHAR NOT NULL DEFAULT 'libre'"),
            ("next_reajustment_date", "DATE DEFAULT NULL"),
        ],
        "charge": [
            ("responsible_type", "VARCHAR NOT NULL DEFAULT 'tenant'"),
            ("accrual_period", "VARCHAR NOT NULL DEFAULT ''"),
            ("settlement_period", "VARCHAR NOT NULL DEFAULT ''"),
        ],
        "propertyownershare": [
            ("is_primary", "BOOLEAN NOT NULL DEFAULT 0"),
            ("irpf_applies", "BOOLEAN NOT NULL DEFAULT 1"),
        ],
        "payment": [
            ("status", "VARCHAR NOT NULL DEFAULT 'confirmado'"),
        ],
        "paymentallocation": [
            ("status", "VARCHAR NOT NULL DEFAULT 'confirmado'"),
        ],
        "cashmovement": [
            ("reversal_of_id", "INTEGER DEFAULT NULL"),
        ],
        "ownercharge": [
            ("split_by_ownership", "BOOLEAN NOT NULL DEFAULT 0"),
            ("reversal_of_id", "INTEGER DEFAULT NULL"),
        ],
        "ownersettlement": [
            ("expenses", "FLOAT NOT NULL DEFAULT 0"),
        ],
        "tenantcredit": [
            ("status", "VARCHAR NOT NULL DEFAULT 'disponible'"),
        ],
        "propertyvisit": [
            ("notification_phone", "VARCHAR NOT NULL DEFAULT ''"),
        ],
    }

    with engine.begin() as connection:
        for table_name, columns in migrations.items():
            if table_name not in table_names:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, definition in columns:
                if column_name not in existing_columns:
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
