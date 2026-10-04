import { Fragment } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@sunstead/ui/components/breadcrumb';
import { getFileIcon } from '@/assets/icons';
import { cn, getFileExtension } from '@/lib/utils';
import { getWorkspaceRelativeSegments } from '@/lib/path-utils';
import { FormattedFileName } from './file-tree';

interface FileBreadcrumbProps {
  filePath: string;
  onNavigate?: (path: string) => void;
  className?: string;
}

export default function FileBreadcrumb({
  filePath,
  onNavigate,
  className,
}: FileBreadcrumbProps) {
  const workspacePath = useWorkspace((s) => s.path);

  if (!workspacePath) return null;

  const { workspaceName, normalizedWorkspace, crumbs } =
    getWorkspaceRelativeSegments(filePath, workspacePath);

  const Icon = getFileIcon(getFileExtension(filePath));

  return (
    <Breadcrumb className={cn('min-w-0 max-w-full', className)}>
      <BreadcrumbList className='flex-nowrap overflow-hidden'>
        <BreadcrumbItem className='min-w-0 shrink'>
          {crumbs.length === 0 ? (
            <BreadcrumbPage className='block truncate'>
              {workspaceName}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              href='#'
              className='block truncate'
              onClick={(e) => {
                e.preventDefault();
                onNavigate?.(normalizedWorkspace);
              }}
            >
              {workspaceName}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {crumbs.map((crumb) => (
          <Fragment key={crumb.path}>
            <BreadcrumbSeparator className='shrink-0' />
            <BreadcrumbItem
              className={crumb.isLast ? 'min-w-0 shrink-0' : 'min-w-0 shrink'}
            >
              {crumb.isLast ? (
                <BreadcrumbPage>
                  <div className='flex items-center gap-2 whitespace-nowrap'>
                    <span className='shrink-0'>
                      <Icon />
                    </span>
                    <FormattedFileName name={crumb.label} />
                  </div>
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  href='#'
                  className='block truncate'
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate?.(crumb.path);
                  }}
                >
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}