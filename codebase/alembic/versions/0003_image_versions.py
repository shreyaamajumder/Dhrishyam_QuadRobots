"""image versions: let a content version be an image

- content_versions.source accepts 'image'. body_text holds the image's text brief
  (harness/vision.py), so the whole text pipeline works on it unchanged.
- version_images keeps the picture, its measurements and the box for each brief line.
  Append-only like content_versions.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f('ck_content_versions_source_valid'), 'content_versions', type_='check')
    op.create_check_constraint(
        op.f('ck_content_versions_source_valid'), 'content_versions',
        "source IN ('paste', 'upload', 'suggestion', 'manual', 'image')")
    op.create_table(
        'version_images',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('version_id', sa.UUID(), nullable=False),
        sa.Column('mime', sa.Text(), nullable=False),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.Text(), nullable=False),
        sa.Column('platform', sa.Text(), nullable=True),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('metrics', postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('regions', postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['version_id'], ['content_versions.id'],
                                name='fk_version_images_version_id_content_versions'),
        sa.PrimaryKeyConstraint('id', name='pk_version_images'),
        sa.UniqueConstraint('version_id', name='uq_version_images_version_id'),
    )
    op.execute("""
        CREATE TRIGGER version_images_no_change
        BEFORE UPDATE OR DELETE ON version_images
        FOR EACH ROW EXECUTE FUNCTION forbid_change()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS version_images_no_change ON version_images")
    op.drop_table('version_images')
    op.drop_constraint(op.f('ck_content_versions_source_valid'), 'content_versions', type_='check')
    op.create_check_constraint(
        op.f('ck_content_versions_source_valid'), 'content_versions',
        "source IN ('paste', 'upload', 'suggestion', 'manual')")
