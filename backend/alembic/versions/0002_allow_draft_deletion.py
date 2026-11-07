"""allow draft deletion via session flag

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-07 20:20:00.000000
"""
from alembic import op

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
        BEGIN
            IF current_setting('brandguard.allow_deletion', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION USING MESSAGE = TG_TABLE_NAME || ' is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION USING MESSAGE = TG_TABLE_NAME || ' is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)

