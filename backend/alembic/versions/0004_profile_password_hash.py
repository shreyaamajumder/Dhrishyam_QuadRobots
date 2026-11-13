"""profile password hash

Revision ID: 0004_profile_password_hash
Revises: 0003
Create Date: 2026-11-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0004_profile_password_hash'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('profiles', sa.Column('password_hash', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('profiles', 'password_hash')
